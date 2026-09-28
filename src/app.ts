import { Bot, Webhook } from '@maxhub/max-bot-api';
import { createServer, type Server } from 'node:http';

import type { BotContext } from './bot/context.js';
import type { AppDeps } from './bot/deps.js';
import { registerHandlers } from './bot/handlers/index.js';
import { createApiNotifier } from './bot/notifier.js';
import type { BotSession } from './bot/session.js';
import { runReminderTick, type ReminderRunResult } from './bot/reminderRunner.js';
import { ensureSubscription, startSubscriptionWatchdog, type WatchdogHandle } from './bot/subscriptionWatchdog.js';
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
import { SettlementService } from './services/settlementService.js';
import { TemplateService } from './services/templateService.js';
import { type MiniappHandle } from './miniapp/server.js';
import type { AnswerMode } from './domain/types.js';
import { startMiniappBridge } from './app/miniappBridge.js';
import { fetchBotInfo, publishCommands } from './bot/botInfo.js';
import { createMiniappTicketStore } from './bot/miniappTickets.js';
import { certificateHint, inspectCaCert, isCertificateError } from './tls.js';

export const BOT_COMMANDS = [
  { name: 'new', description: 'Создать событие' },
  { name: 'events', description: 'Мои события и панель участников' },
  { name: 'templates', description: 'Наборы вопросов для участников' },
  { name: 'join', description: 'Присоединиться к событию по коду' },
  { name: 'duties', description: 'Мои расчёты с участниками' },
  { name: 'profile', description: 'Профиль и реквизиты для переводов' },
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
  const settlements = new SettlementService(repos);
  const templates = new TemplateService(repos);
  const reminders = new ReminderService(repos, config);
  const debug = new DebugService({ events, participants, items }, config);

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
  const webhookHandler = webhookUrl
    ? bot.webhookCallback({
      domain: webhookUrl.origin,
      path: webhookPath!,
      port: config.webhookPort,
      secret: config.webhookSecret,
    })
    : null;
  /** Собственный сервер вебхука — включается, только если мини-приложение выключено. */
  let ownWebhookServer: Server | null = null;
  /** Повтор знакомства с ботом, если MAX не ответил при старте. */
  let botInfoTimer: NodeJS.Timeout | null = null;

  const deps: AppDeps = {
    config,
    logger,
    repos,
    profiles,
    events,
    participants,
    items,
    settlements,
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

  let tickTimer: NodeJS.Timeout | null = null;
  let ticking = false;
  /** Проверка живости подписки на вебхук: MAX теряет её при обрыве связи. */
  let webhookWatchdog: WatchdogHandle | null = null;

  const tick = async (now: Date = new Date()): Promise<ReminderRunResult> => {
    const empty: ReminderRunResult = { confirmSent: 0, finalSent: 0, closed: 0, errors: 0 };
    if (ticking) return empty;
    ticking = true;
    try {
      const result = await runReminderTick(deps, now);
      if (result.confirmSent || result.finalSent || result.closed || result.errors) {
        logger.info(
          `Напоминания: подтверждение — ${result.confirmSent}, детали — ${result.finalSent}, `
            + `закрыто событий — ${result.closed}, ошибок — ${result.errors}`,
        );
      }
      return result;
    } catch (error) {
      logger.error('Ошибка планировщика напоминаний', error);
      return { ...empty, errors: 1 };
    } finally {
      ticking = false;
    }
  };

  const start = async (): Promise<void> => {
    assertRunnableConfig(config);
    logger.info(`Сертификаты: ${inspectCaCert().note}`);
    logger.info(`База данных: ${config.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);

    // Знакомство с ботом не должно мешать запуску: при обрыве связи или DNS
    // MAX может не ответить, и раньше это оставляло бота без подписки на вебхук.
    const botInfo = await fetchBotInfo(bot.api, logger);
    if (botInfo) {
      bot.botInfo = botInfo;
      logger.info(`Бот @${botInfo.username ?? 'unknown'} (id ${botInfo.user_id}), режим ${config.botMode}`);
      await publishCommands(bot.api, BOT_COMMANDS, logger);
    } else {
      // Имя бота нужно для ссылок-приглашений: повторяем попытку в фоне.
      botInfoTimer = setInterval(() => {
        void (async () => {
          const retry = await fetchBotInfo(bot.api, logger);
          if (!retry) return;
          bot.botInfo = retry;
          if (botInfoTimer) clearInterval(botInfoTimer);
          botInfoTimer = null;
          logger.info(`Данные бота получены: @${retry.username ?? 'unknown'}`);
          await publishCommands(bot.api, BOT_COMMANDS, logger);
        })();
      }, config.webhookCheckSeconds * 1000);
      botInfoTimer.unref?.();
    }

    if (config.botMode === 'webhook' && webhookUrl && webhookHandler) {
      const subscriptionUrl = `${webhookUrl.origin}${webhookPath}`;
      // Чистим прежние подписки (кроме нашей) и подписываемся заново.
      try {
        await Webhook.clearSubscriptions(bot.api, subscriptionUrl);
      } catch (error) {
        logger.warn('Не удалось очистить прежние подписки', error);
      }

      const state = await ensureSubscription({
        api: bot.api,
        logger,
        url: subscriptionUrl,
        secret: config.webhookSecret,
      });
      if (state === 'failed') {
        // Связи нет прямо сейчас: не выходим, иначе бот останется без доставки
        // до ручного перезапуска. Сторож оформит подписку, как только сеть вернётся.
        logger.warn(
          `Не удалось подписаться на ${subscriptionUrl} — повторю при восстановлении связи`,
        );
      } else {
        logger.info(`Подписка на ${subscriptionUrl} активна`);
      }

      if (miniapp) {
        logger.info(`Webhook обслуживает сервер мини-приложения на порту ${miniapp.port}`);
      } else {
        const server = createServer((req, res) => webhookHandler(req, res));
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(config.webhookPort, '0.0.0.0', () => resolve());
        });
        ownWebhookServer = server;
        logger.info(`Webhook слушает порт ${config.webhookPort}`);
      }

      // Домашний интернет рвётся: следим, что MAX по-прежнему шлёт обновления нам.
      webhookWatchdog = startSubscriptionWatchdog({
        api: bot.api,
        logger,
        url: subscriptionUrl,
        secret: config.webhookSecret,
        intervalMs: config.webhookCheckSeconds * 1000,
      });
      logger.info(`Проверка подписки каждые ${config.webhookCheckSeconds} с`);
    } else {
      // В long polling подписка на вебхук только мешает: MAX доставлял бы
      // обновления на старый адрес, а не в опрос. Снимаем её.
      try {
        await Webhook.clearSubscriptions(bot.api);
        logger.info('Подписки на вебхук сняты: обновления получаем long polling');
      } catch (error) {
        logger.warn('Не удалось снять подписки на вебхук', error);
      }
      void bot.startPolling({ retry: true }).catch((error: unknown) => {
        logger.error('Long polling остановлен с ошибкой', error);
        if (isCertificateError(error)) logger.error(certificateHint());
      });
      logger.info(`Long polling запущен, напоминания проверяются каждые ${config.reminderTickSeconds} с`);
    }

    storage.start();
    tickTimer = setInterval(() => void tick(), config.reminderTickSeconds * 1000);
    await tick();
  };

  const stop = async (): Promise<void> => {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    webhookWatchdog?.stop();
    webhookWatchdog = null;
    if (botInfoTimer) {
      clearInterval(botInfoTimer);
      botInfoTimer = null;
    }
    bot.stopPolling();
    try {
      await bot.stopWebhook();
    } catch {
      // Вебхук мог быть не запущен.
    }
    await miniapp?.close();
    if (ownWebhookServer) {
      await new Promise<void>((resolve) => ownWebhookServer!.close(() => resolve()));
    }
    await storage.stop();
    logger.info('Остановлено, соединение с БД закрыто');
  };

  return { bot, deps, db, start, stop, tick };
};
