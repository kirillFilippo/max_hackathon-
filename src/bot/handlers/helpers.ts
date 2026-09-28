import type { Context } from '@maxhub/max-bot-api';

import type { DosugEvent } from '../../domain/types.js';
import { replyTo, show, type BotContext } from '../context.js';
import type { AppDeps } from '../deps.js';
import { menuRow, withKeyboard, type MessageContent } from '../message.js';

export { menuRow };

export type SdkUser = NonNullable<Context['user']>;

export const requireUser = (ctx: BotContext): SdkUser => {
  const user = ctx.user;
  if (!user) throw new Error(`Обновление ${ctx.updateType} не содержит пользователя`);
  return user;
};

export const userIdOf = (ctx: BotContext): number => requireUser(ctx).user_id;

export const botUsernameOf = (ctx: BotContext, deps: AppDeps): string | undefined =>
  ctx.botInfo?.username ?? deps.config.botUsername;

/**
 * Находит событие по коду; если его нет — отвечает пользователю и возвращает null.
 * Раньше этот блок с одинаковым текстом был скопирован в тринадцати местах.
 */
export const findEventOrNotify = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<DosugEvent | null> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return null;
  }
  return event;
};

/** То же для мастера, где событие уже известно по id, а не по коду. */
export const findEventByIdOrNotify = async (
  ctx: BotContext,
  deps: AppDeps,
  eventId: string,
): Promise<DosugEvent | null> => {
  const event = await deps.events.findById(eventId);
  if (!event) {
    await show(ctx, withKeyboard('Событие не найдено.', menuRow));
    return null;
  }
  return event;
};

/**
 * Обёртка обработчика: ошибка логируется, пользователь получает понятный ответ.
 * Одна на команды и на обработчики кнопок — отличается только текст сообщения.
 */
export const withErrorHandling = (
  deps: AppDeps,
  scope: string,
  handler: (ctx: BotContext) => Promise<unknown>,
  options: { message?: string; kind?: string } = {},
): ((ctx: BotContext) => Promise<void>) => {
  const kind = options.kind ?? 'обработчике';
  const message = options.message ?? 'Не получилось выполнить действие. Попробуйте ещё раз.';
  return async (ctx: BotContext) => {
    try {
      await handler(ctx);
    } catch (error) {
      deps.logger.error(`Ошибка в ${kind} ${scope}`, error);
      try {
        await replyTo(ctx, withKeyboard(message, menuRow));
      } catch (secondary) {
        deps.logger.error('Не удалось отправить сообщение об ошибке', secondary);
      }
    }
  };
};

/** Рассылка участникам события. Возвращает число доставленных сообщений. */
export const notifyParticipants = async (
  deps: AppDeps,
  event: DosugEvent,
  content: MessageContent,
  options: { includeNotGoing?: boolean; onlyUserId?: number } = {},
): Promise<number> => {
  const participants = await deps.repos.participants.listByEvent(event.id);
  let sent = 0;
  for (const participant of participants) {
    if (!options.includeNotGoing && participant.status === 'not_going') continue;
    if (options.onlyUserId !== undefined && participant.userId !== options.onlyUserId) continue;
    try {
      await deps.notifier.sendToUser(participant.userId, content);
      sent += 1;
    } catch (error) {
      deps.logger.warn(`Не удалось отправить сообщение участнику ${participant.userId}`, error);
    }
  }
  return sent;
};

export const sendToUser = async (
  deps: AppDeps,
  userId: number,
  content: MessageContent,
): Promise<boolean> => {
  try {
    await deps.notifier.sendToUser(userId, content);
    return true;
  } catch (error) {
    deps.logger.warn(`Не удалось отправить сообщение пользователю ${userId}`, error);
    return false;
  }
};

/**
 * Имя участника для списка покупок.
 *
 * Раньше в бронь попадало имя из профиля MAX, и в списке человек мог оказаться
 * под другим именем, чем в «Участниках» (где видно имя из заявки). Теперь берём
 * имя заявки, а профиль MAX — только как запасной вариант.
 */
export const participantNameFor = async (
  ctx: BotContext,
  deps: AppDeps,
  eventId: string,
): Promise<string> => {
  const user = requireUser(ctx);
  const participant = await deps.participants.find(eventId, user.user_id);
  const fromDraft = participant?.name?.trim();
  return fromDraft && fromDraft.length > 0 ? fromDraft : user.name;
};
