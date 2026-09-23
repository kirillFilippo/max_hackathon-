import { createHash } from 'node:crypto';

import type { MiddlewareFn } from '@maxhub/max-bot-api';

import type { BotContext } from '../context.js';
import type { Logger } from '../../logger.js';

/**
 * Защита от повторной обработки одного и того же действия.
 *
 * Почему это нужно: платформа может доставить обновление повторно (переподключение
 * long polling, рестарт бота), а пользователь — успеть нажать кнопку дважды, пока
 * предыдущий шаг ещё обрабатывается. Без защиты один и тот же шаг мастера
 * выполняется несколько раз: бот пропускает шаги и присылает несколько сообщений.
 *
 * Два ключа:
 *  - точный (`update_type:timestamp:message:payload`) — ловит повторную доставку
 *    того же самого обновления;
 *  - смысловой (`user:message:payload`) — ловит двойное нажатие одной и той же
 *    кнопки в одном и том же сообщении. Живёт недолго, чтобы осознанное повторное
 *    нажатие через полминуты (например, «Обновить») снова работало.
 */
/**
 * Действия, которые повторяют осознанно и в том же сообщении: снять галочку в
 * мультивыборе, обновить список. Их защищаем только от точной повторной доставки,
 * но не от повторного нажатия — иначе «отменить выбор» не сработает.
 */
const REPEATABLE_PAYLOADS: RegExp[] = [
  /^reg:toggle:/,
  /^ev:people:/,
  /^shop:show/,
  /^shop:mine/,
  /^money:show/,
  /^tq:refresh/,
];

export const isRepeatableAction = (payload: string): boolean =>
  REPEATABLE_PAYLOADS.some((pattern) => pattern.test(payload));

export interface DedupeOptions {
  /** Сколько помнить точные обновления (повторная доставка). */
  exactTtlMs?: number;
  /** Сколько помнить смысловые нажатия (двойной тап). */
  actionTtlMs?: number;
  /** Сколько помнить вход в бота: `bot_started` и `/start` — одно действие. */
  startTtlMs?: number;
  /**
   * Короткое окно «то же действие»: два нажатия одной кнопки подряд быстрее этого
   * времени считаем двойным тапом, даже если экран уже сменился. Живой человек
   * между осознанными нажатиями успевает прочитать новый экран.
   */
  sameActionCooldownMs?: number;
  /** Предел записей, чтобы память не росла. */
  maxEntries?: number;
}

interface SlimUpdate {
  update_type?: string;
  timestamp?: number;
  payload?: string | null;
  message?: {
    body?: { mid?: string; text?: string | null; attachments?: unknown } | null;
  } | null;
  callback?: { payload?: string | null } | null;
  user?: { user_id?: number } | null;
}

/**
 * Вход в бота приходит двумя обновлениями: `bot_started` с payload и сообщение
 * `/start <payload>`. Смысловой ключ у них один — иначе участник получает
 * приглашение дважды. Возвращает ключ входа или null, если это не вход.
 */
const startActionKey = (type: string, update: SlimUpdate): string | null => {
  if (type === 'bot_started') return (update.payload ?? '').trim();
  if (type !== 'message_created') return null;
  const text = update.message?.body?.text?.trim() ?? '';
  const match = /^\/start(?:@[\w_]+)?(?:\s+(\S+))?$/i.exec(text);
  return match ? (match[1] ?? '') : null;
};

/**
 * Отпечаток экрана: текст сообщения и клавиатура. Нужен, потому что после
 * обработки шага бот редактирует то же сообщение — и на соседних шагах часто
 * стоит одна и та же кнопка (например, «Пропустить»). Без отпечатка повторное
 * нажатие такой кнопки считалось бы дублем и мастер застревал.
 */
const screenFingerprint = (message: SlimUpdate['message']): string => {
  const text = message?.body?.text ?? '';
  const attachments = JSON.stringify(message?.body?.attachments ?? []);
  return createHash('sha1').update(`${text}\u0000${attachments}`).digest('hex').slice(0, 12);
};

export class UpdateDeduplicator {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    private readonly options: DedupeOptions = {},
  ) {}

  private get exactTtl(): number {
    return this.options.exactTtlMs ?? 5 * 60 * 1000;
  }

  private get actionTtl(): number {
    return this.options.actionTtlMs ?? 20 * 1000;
  }

  private get sameActionCooldown(): number {
    return this.options.sameActionCooldownMs ?? 250;
  }

  private get startTtl(): number {
    return this.options.startTtlMs ?? 20 * 1000;
  }

  private get maxEntries(): number {
    return this.options.maxEntries ?? 5000;
  }

  /** Возвращает true, если это обновление уже обрабатывали и его надо пропустить. */
  isDuplicate(ctx: BotContext): boolean {
    const update = ctx.update as unknown as SlimUpdate;
    const type = update.update_type ?? 'unknown';
    const mid = update.message?.body?.mid ?? '';
    const payload = update.callback?.payload ?? '';
    const userId = update.user?.user_id ?? ctx.user?.user_id ?? 0;
    const now = Date.now();

    this.evict(now);

    const exactKey = `e:${type}:${update.timestamp ?? 0}:${mid}:${payload}`;
    const exactDuplicate = this.touch(exactKey, now, this.exactTtl);

    // Вход в бота: `bot_started` и `/start <payload>` — одно действие, не два.
    const startKey = startActionKey(type, update);
    if (startKey !== null && this.touch(`s:${userId}:${startKey}`, now, this.startTtl)) {
      this.logger.debug(`Пропускаю повторный вход в бота (${startKey || 'без payload'})`);
      return true;
    }

    // Смысловой ключ только для кнопок: у текстовых сообщений mid уникален.
    // В ключ входит отпечаток экрана, иначе одинаковые кнопки на соседних шагах
    // (после редактирования сообщения) блокировали бы переход.
    let actionDuplicate = false;
    if (type === 'message_callback' && mid && !isRepeatableAction(payload)) {
      const actionKey = `a:${userId}:${mid}:${payload}`;
      const screen = screenFingerprint(update.message);
      // Тот же экран — двойной тап (даже если он пришёл позже).
      const sameScreen = this.seen.get(`${actionKey}:${screen}`) !== undefined;
      // Другой экран, но подряд быстрее кулдауна — тоже двойной тап.
      const tooFast = now - (this.seen.get(`${actionKey}:last`) ?? 0) < this.sameActionCooldown;
      actionDuplicate = sameScreen || tooFast;
      this.touch(`${actionKey}:${screen}`, now, this.actionTtl);
      this.touch(`${actionKey}:last`, now, this.actionTtl);
    }

    this.trim();

    if (exactDuplicate) {
      this.logger.debug(`Пропускаю повторно доставленное обновление ${type}`);
      return true;
    }
    if (actionDuplicate) {
      this.logger.debug(`Пропускаю повторное нажатие кнопки ${payload}`);
      return true;
    }
    return false;
  }

  private touch(key: string, now: number, ttlMs: number): boolean {
    const seenAt = this.seen.get(key);
    if (seenAt !== undefined && now - seenAt < ttlMs) return true;
    // Перезаписываем время: запись живёт от последнего обращения.
    this.seen.delete(key);
    this.seen.set(key, now);
    return false;
  }

  private evict(now: number): void {
    for (const [key, seenAt] of this.seen) {
      const ttl = key.startsWith('a:')
        ? this.actionTtl
        : key.startsWith('s:')
          ? this.startTtl
          : this.exactTtl;
      if (now - seenAt >= ttl) this.seen.delete(key);
    }
  }

  /** Память не должна расти: храним не больше maxEntries самых свежих записей. */
  private trim(): void {
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
  }

  /** Размер карты — нужно тестам и диагностике. */
  get size(): number {
    return this.seen.size;
  }
}

export const dedupeMiddleware = (deduplicator: UpdateDeduplicator): MiddlewareFn<BotContext> => {
  return async (ctx, next) => {
    if (deduplicator.isDuplicate(ctx)) return undefined;
    return next();
  };
};
