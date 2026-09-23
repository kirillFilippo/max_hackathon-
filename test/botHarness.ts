import { randomUUID } from 'node:crypto';

import { Bot } from '@maxhub/max-bot-api';

import type { BotContext } from '../src/bot/context.js';
import type { AppDeps } from '../src/bot/deps.js';
import { registerHandlers } from '../src/bot/handlers/index.js';
import { createApiNotifier } from '../src/bot/notifier.js';
import type { BotSession } from '../src/bot/session.js';
import type { Db } from '../src/db/pool.js';
import { PgSessionStore } from '../src/db/sessions.js';
import { EventService } from '../src/services/eventService.js';
import { ItemService } from '../src/services/itemService.js';
import { ParticipantService } from '../src/services/participantService.js';
import { ProfileService } from '../src/services/profileService.js';
import { ReminderService } from '../src/services/reminderService.js';
import { SettlementService } from '../src/services/settlementService.js';
import { TemplateService } from '../src/services/templateService.js';
import { startHarness, type Harness } from './support.js';

/**
 * Харнесс «настоящий бот + фейковый MAX API».
 *
 * Гоняет реальные обработчики, сессии, роутеры и сервисы: так ловятся ошибки
 * маршрутизации и падения в мастерах, которые не видны в юнит-тестах. Ответы
 * бота записываются, поэтому можно проверять, что именно он прислал.
 */
export interface SentMessage {
  chatId: number;
  mid?: string;
  text: string;
  format?: string;
  attachments?: unknown;
}

export interface BotHarness extends Harness {
  bot: Bot<BotContext>;
  sent: SentMessage[];
  base: Harness;
  /** Сообщение от пользователя. */
  sendText(text: string, options?: {
    chatId?: number;
    userId?: number;
    mid?: string;
    rapid?: boolean;
  }): Promise<void>;
  /** Нажатие inline-кнопки. */
  click(payload: string, options?: {
    chatId?: number;
    userId?: number;
    mid?: string;
    /** Без паузы после клика: нужно для проверки двойного тапа. */
    rapid?: boolean;
  }): Promise<void>;
  /** Запуск бота по диплинку (или без него). */
  start(payload?: string, options?: { chatId?: number; userId?: number }): Promise<void>;
  /** Тексты ответов бота (можно ограничить одним чатом). */
  texts(chatId?: number): string[];
  /** Последний ответ бота. */
  lastText(chatId?: number): string;
  /** Все кнопки из последнего ответа бота: текст, payload и ссылка. */
  lastButtons(chatId?: number): Array<{ text: string; payload: string; url: string }>;
  /** Все показанные экраны: новые сообщения и правки. */
  screens(chatId?: number): SentMessage[];
  clearSent(): void;
  stop(): Promise<void>;
}

/** Пауза между шагами в тестах: имитирует чтение нового экрана человеком. */
const PACE_MS = 300;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

export const createBotHarness = async (): Promise<BotHarness> => {
  const base = await startHarness();
  const sent: SentMessage[] = [];
  /** Все показанные экраны: новые сообщения и правки — в порядке появления. */
  const screens: SentMessage[] = [];
  /** Какому чату принадлежит сообщение — нужно, чтобы привязать правку. */
  const currentScreenChat = new Map<string, number>();
  /** Текущее состояние сообщения: нужно, чтобы нажатие кнопки приходило с тем же экраном. */
  const screenState = new Map<string, { text: string; attachments: unknown }>();
  /** Сообщение, которое пользователь видит в чате: с него и приходит нажатие кнопки. */
  const currentMidByChat = new Map<number, string>();
  let midCounter = 0;
  let messageCounter = 0;
  /** Счётчик синтетических mid для нажатий, у которых нет сообщения бота. */
  let syntheticMidCounter = 0;

  const botUser = {
    user_id: 1000,
    name: 'Ассистент',
    first_name: 'Ассистент',
    is_bot: true,
    username: 'DosugTestBot',
    last_activity_time: 0,
  };

  // Фейковый Bot API: записывает исходящие сообщения и отвечает как платформа.
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\//, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;

    if (method === 'GET' && path === 'me') return json(botUser);

    if (method === 'POST' && path === 'messages') {
      const chatId = Number(url.searchParams.get('chat_id') ?? url.searchParams.get('user_id') ?? 0);
      midCounter += 1;
      const text = typeof body?.text === 'string' ? body.text : '';
      const message = {
        sender: botUser,
        recipient: { chat_id: chatId, chat_type: 'dialog', user_id: chatId, post_id: null },
        timestamp: Date.now(),
        body: { mid: `mid-${midCounter}`, seq: midCounter, text, attachments: body?.attachments ?? [] },
      };
      const record: SentMessage = {
        chatId,
        mid: message.body.mid,
        text,
        format: typeof body?.format === 'string' ? body.format : undefined,
        attachments: body?.attachments,
      };
      sent.push(record);
      screens.push(record);
      currentScreenChat.set(message.body.mid, chatId);
      currentMidByChat.set(chatId, message.body.mid);
      screenState.set(message.body.mid, { text, attachments: body?.attachments ?? [] });
      return json({ message });
    }

    if (method === 'PUT' && path === 'messages') {
      // Правка того же сообщения — тоже экран: без учёта правок тесты не видят,
      // что бот показал после нажатия кнопки.
      const text = typeof body?.text === 'string' ? body.text : '';
      const mid = url.searchParams.get('message_id') ?? 'mid-0';
      const chatId = Number(
        (currentScreenChat.get(mid) ?? 0)
        || url.searchParams.get('chat_id')
        || 0,
      );
      screens.push({
        chatId,
        mid,
        text,
        format: typeof body?.format === 'string' ? body.format : undefined,
        attachments: body?.attachments,
      });
      screenState.set(mid, { text, attachments: body?.attachments ?? [] });
      currentMidByChat.set(chatId, mid);
      return json({ success: true });
    }
    if (method === 'POST' && path === 'answers') return json({ success: true });
    if (method === 'GET' && path === 'updates') return json({ updates: [], marker: null });

    return json({ success: true });
  };

  const bot = new Bot<BotContext>('test-token', { clientOptions: { fetch: fakeFetch } });
  bot.botInfo = botUser;

  const repos = base.repos;
  const sessionStore = new PgSessionStore<BotSession>(base.db, 24 * 3_600_000);
  const profiles = new ProfileService(repos);
  const events = new EventService(repos, base.config);
  const participants = new ParticipantService(repos);
  const items = new ItemService(repos);
  const settlements = new SettlementService(repos);
  const templates = new TemplateService(repos);
  const reminders = new ReminderService(repos, base.config);
  const notifier = createApiNotifier(bot.api);

  const deps: AppDeps = {
    config: base.config,
    logger: base.logger,
    repos,
    profiles,
    events,
    participants,
    items,
    settlements,
    templates,
    reminders,
    notifier,
    sessions: sessionStore,
    miniapp: null,
  };

  registerHandlers(bot, deps, sessionStore);

  const user = (userId: number) => ({
    user_id: userId,
    name: 'Тестовый организатор',
    first_name: 'Тестовый',
    last_name: 'Организатор',
    username: 'tester',
    is_bot: false,
    last_activity_time: 0,
  });

  const handleUpdate = async (update: Record<string, unknown>): Promise<void> => {
    // handleUpdate приватный, но именно он прогоняет цепочку middleware.
    await (bot as unknown as { handleUpdate(u: unknown): Promise<void> }).handleUpdate(update);
  };

  const messageUpdate = (
    chatId: number,
    userId: number,
    text: string,
    mid: string,
  ): Record<string, unknown> => ({
    update_type: 'message_created',
    timestamp: Date.now(),
    message: {
      sender: user(userId),
      recipient: { chat_id: chatId, chat_type: 'dialog', user_id: userId, post_id: null },
      timestamp: Date.now(),
      body: { mid, seq: 1, text, attachments: [] },
    },
  });

  const callbackUpdate = (
    chatId: number,
    userId: number,
    payload: string,
    mid: string,
  ): Record<string, unknown> => {
    // Платформа присылает сообщение в том виде, в каком его видел пользователь.
    const state = screenState.get(mid);
    // Запоминаем чат сообщения, чтобы правки этого сообщения попадали в тот же чат.
    if (!currentScreenChat.has(mid)) currentScreenChat.set(mid, chatId);
    return {
    update_type: 'message_callback',
    timestamp: Date.now(),
    callback: {
      timestamp: Date.now(),
      callback_id: `cb-${randomUUID()}`,
      payload,
      user: user(userId),
    },
      message: {
        sender: botUser,
        recipient: { chat_id: chatId, chat_type: 'dialog', user_id: userId, post_id: null },
        timestamp: Date.now(),
        body: {
          mid,
          seq: 1,
          text: state?.text ?? 'предыдущий экран',
          attachments: state?.attachments ?? [],
        },
      },
    };
  };

  const screensOf = (chatId?: number): SentMessage[] =>
    screens.filter((screen) => chatId === undefined || screen.chatId === chatId);

  const textsOf = (chatId?: number): string[] => screensOf(chatId).map((screen) => screen.text);

  const nextMid = (): string => {
    messageCounter += 1;
    return `user-mid-${messageCounter}`;
  };

  return {
    ...base,
    // Важно: депы именно этого харнесса (доставка через фейковый Bot API),
    // а не вспомогательного — иначе вызовы вроде applyMiniappFields не видны.
    deps,
    bot,
    sent,
    base,
    async sendText(text, options = {}) {
      const chatId = options.chatId ?? 500;
      const userId = options.userId ?? chatId;
      await handleUpdate(messageUpdate(chatId, userId, text, options.mid ?? nextMid()));
      if (!options.rapid) await delay(PACE_MS);
    },
    async click(payload, options = {}) {
      const chatId = options.chatId ?? 500;
      const userId = options.userId ?? chatId;
      // Кнопку нажимают в том сообщении, которое видят: берём последний экран чата.
      // Синтетический mid обязан быть уникальным, как в MAX: иначе нажатия из разных
      // тестов совпадают по ключу дедупликатора (пользователь + mid + payload) и
      // второй клик молча пропадает.
      const mid = options.mid
        ?? currentMidByChat.get(chatId)
        ?? `bot-mid-${payload}-${(syntheticMidCounter += 1)}`;
      await handleUpdate(callbackUpdate(chatId, userId, payload, mid));
      // Живой человек не нажимает следующую кнопку через миллисекунду; пауза делает
      // прогон похожим на реальный и не даёт сработать защите от двойного тапа.
      if (!options.rapid) await delay(PACE_MS);
    },
    async start(payload, options = {}) {
      const chatId = options.chatId ?? 500;
      const userId = options.userId ?? chatId;
      await handleUpdate({
        update_type: 'bot_started',
        timestamp: Date.now(),
        chat_id: chatId,
        user: user(userId),
        payload: payload ?? null,
      });
    },
    screens(chatId) {
      return screensOf(chatId);
    },
    texts(chatId) {
      return textsOf(chatId);
    },
    lastText(chatId) {
      const list = textsOf(chatId);
      return list[list.length - 1] ?? '';
    },
    lastButtons(chatId) {
      const target = [...screensOf(chatId)].reverse()[0];
      const attachments = (target?.attachments ?? []) as Array<{
        type?: string;
        payload?: { buttons?: Array<Array<{ text: string; payload?: string; url?: string }>> };
      }>;
      const keyboard = attachments.find((item) => item.type === 'inline_keyboard');
      return (keyboard?.payload?.buttons ?? []).flat().map((button) => ({
        text: button.text,
        payload: button.payload ?? '',
        // Кнопка-ссылка несёт url, а не payload: тесты проверяют ссылки на мини-приложение.
        url: button.url ?? '',
      }));
    },
    clearSent() {
      sent.length = 0;
      screens.length = 0;
      currentScreenChat.clear();
      currentMidByChat.clear();
      // Экраны прошлого теста не должны прилипать к тем же mid в следующем.
      screenState.clear();
    },
    async stop() {
      await base.stop();
    },
  };
};

export type { Db };
