import { Bot } from '@maxhub/max-bot-api';

import type { BotContext } from './bot/context.js';
import type { AppDeps } from './bot/deps.js';
import { registerHandlers } from './bot/handlers/index.js';
import { createApiNotifier } from './bot/notifier.js';
import type { BotSession } from './bot/session.js';
import type { ReminderRunResult } from './bot/reminderRunner.js';
import { assertRunnableConfig, type AppConfig } from './config.js';
import type { Db } from './db/pool.js';
import type { PgSessionStore } from './db/sessions.js';
import { createStorage } from './db/storage.js';
import { createLogger, type Logger } from './logger.js';
import { EventService } from './services/eventService.js';
import { ItemService } from './services/itemService.js';
import { ParticipantService } from './services/participantService.js';
import { ProfileService } from './services/profileService.js';
import { DebugService } from './services/debugService.js';
import { ReminderService } from './services/reminderService.js';
import { TemplateService } from './services/templateService.js';
import { type MiniappHandle } from './miniapp/server.js';
import { startMiniappBridge } from './app/miniappBridge.js';
import { announceBot, type AnnouncementHandle, type BotCommand } from './app/botAnnouncement.js';
import { startDelivery, type DeliveryHandle, type WebhookCallback } from './app/delivery.js';
import { createReminderScheduler } from './app/reminderScheduler.js';
import { createMiniappTicketStore } from './bot/miniappTickets.js';
import { inspectCaCert } from './tls.js';

export const BOT_COMMANDS: BotCommand[] = [
  { name: 'new', description: 'Создать событие' },
  { name: 'events', description: 'Мои события и панель участников' },
  { name: 'templates', description: 'Наборы вопросов для участников' },
  { name: 'join', description: 'Присоединиться к событию по коду' },
  { name: 'profile', description: 'Профиль и контакт для связи' },
  { name: 'faq', description: 'Частые вопросы' },
  { name: 'help', description: 'Как работает бот' },
  { name: 'cancel', description: 'Прервать текущий шаг' },
];

export interface AppHandle {
  bot: Bot<BotContext>;
  deps: AppDeps;
  db: Db;
  start(): Promise<void>;
  stop(): Promise<void>;
  tick(now?: Date): Promise<ReminderRunResult>;
}

/**
 * Сборка приложения: хранилище, сервисы, бот, мини-приложение и обработчики.
 *
 * Здесь остаётся только композиция и порядок запуска. Доставка обновлений живёт
 * в `app/delivery.ts`, знакомство с ботом — в `app/botAnnouncement.ts`,
 * планировщик напоминаний — в `app/reminderScheduler.ts`.
 */
export const createApp = async (
  config: AppConfig,
  logger: Logger = createLogger(config.logLevel),
): Promise<AppHandle> => {
  // Хранилище само решает, откуда брать данные: PostgreSQL, память или оба
  // (при обрыве связи бот продолжает работать и синхронизируется позже).
  const storage = await createStorage(config, logger);
  const db = storage.db;
  const repos = storage.repositories;
  const sessionStore = storage.sessions as unknown as PgSessionStore<BotSession>;

  const profiles = new ProfileService(repos);
  const events = new EventService(repos, config);
  const participants = new ParticipantService(repos);
  const items = new ItemService(repos);
  const templates = new TemplateService(repos);
  const reminders = new ReminderService(repos, config);
  const debug = new DebugService({ events, participants, items });

  const bot = new Bot<BotContext>(config.botToken);
  const notifier = createApiNotifier(bot.api);

  // Мини-приложение конструктора вопросов: включается, если задан MINIAPP_URL.
  // Подписи конструктора живут в хранилище сессий: переживают перезапуск и деплой.
  const tickets = createMiniappTicketStore(storage.sessions);
  let miniapp: MiniappHandle | null = null;
  let miniappBridge: AppDeps['miniapp'] = null;

  // В режиме вебхука обработчик апдейтов готовим сразу: сервер мини-приложения
  // монтирует его на свой порт, поэтому наружу нужен один маршрут.
  const webhookUrl = config.botMode === 'webhook' && config.webhookUrl ? new URL(config.webhookUrl) : null;
  const webhookPath = webhookUrl
    ? (webhookUrl.pathname === '/' ? config.webhookPath : webhookUrl.pathname)
    : undefined;
  const webhookHandler: WebhookCallback | null = webhookUrl
    ? bot.webhookCallback({
      domain: webhookUrl.origin,
      path: webhookPath!,
      port: config.webhookPort,
      secret: config.webhookSecret,
    })
    : null;

  const deps: AppDeps = {
    config,
    logger,
    repos,
    profiles,
    events,
    participants,
    items,
    templates,
    reminders,
    debug,
    notifier,
    sessions: sessionStore,
    miniapp: null,
  };

  if (config.miniappUrl) {
    const started = await startMiniappBridge({
      config,
      logger,
      storage,
      bot,
      notifier,
      deps,
      miniappUrl: config.miniappUrl,
      tickets,
      webhookPath,
      webhookHandler: webhookHandler ?? undefined,
    });
    miniapp = started.handle;
    miniappBridge = started.bridge;
    deps.miniapp = miniappBridge;
    logger.info(`Мини-приложение вопросов: ${config.miniappUrl} (локальный порт ${started.handle.port})`);
  }

  registerHandlers(bot, deps, sessionStore);

  const scheduler = createReminderScheduler(deps, config, logger);
  let announcement: AnnouncementHandle | null = null;
  let delivery: DeliveryHandle | null = null;

  const start = async (): Promise<void> => {
    assertRunnableConfig(config);
    logger.info(`Сертификаты: ${inspectCaCert().note}`);
    logger.info(`База данных: ${config.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);

    announcement = await announceBot(bot, config, logger, BOT_COMMANDS);
    delivery = await startDelivery({
      bot,
      config,
      logger,
      webhookUrl,
      webhookPath,
      webhookHandler,
      miniappPort: miniapp?.port ?? null,
    });

    storage.start();
    scheduler.start();
    await scheduler.tick();
  };

  const stop = async (): Promise<void> => {
    scheduler.stop();
    announcement?.stop();
    announcement = null;
    await delivery?.stop();
    delivery = null;
    await miniapp?.close();
    await storage.stop();
    logger.info('Остановлено, соединение с БД закрыто');
  };

  return {
    bot,
    deps,
    db,
    start,
    stop,
    tick: (now?: Date) => scheduler.tick(now),
  };
};
