import { Bot, Webhook } from '@maxhub/max-bot-api';
import { createServer, type Server } from 'node:http';

import type { BotContext } from './bot/context.js';
import type { AppDeps } from './bot/deps.js';
import { registerHandlers } from './bot/handlers/index.js';
import { createApiNotifier } from './bot/notifier.js';
import type { BotSession } from './bot/session.js';
import { runReminderTick, type ReminderRunResult } from './bot/reminderRunner.js';
import {
  ensureSubscription,
  startSubscriptionWatchdog,
  type WatchdogHandle,
} from './bot/subscriptionWatchdog.js';
import { assertRunnableConfig, type AppConfig } from './config.js';
import type { Db } from './db/pool.js';
import type { PgSessionStore } from './db/sessions.js';
import { createStorage } from './db/storage.js';
import { newFieldId } from './domain/ids.js';
import { createLogger, type Logger } from './logger.js';
import { EventService } from './services/eventService.js';
import { ItemService } from './services/itemService.js';
import { ParticipantService } from './services/participantService.js';
import { ProfileService } from './services/profileService.js';
import { DebugService } from './services/debugService.js';
import { ReminderService } from './services/reminderService.js';
import { SettlementService } from './services/settlementService.js';
import { TemplateService } from './services/templateService.js';
import { startMiniappServer, type MiniappField, type MiniappHandle } from './miniapp/server.js';
import { normalizeField } from './domain/questionnaire.js';
import type { AnswerMode } from './domain/types.js';
import { formatDateTime } from './domain/datetime.js';
import { STATUS_LABELS } from './domain/types.js';
import { registrationNotice } from './bot/texts/registration.js';
import { applyMiniappFields, readDraftQuestionnaire } from './bot/handlers/miniappSync.js';
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
  // Одноразовые подписи конструктора вопросов: живут ограниченное время.
  const tickets = new Map<string, { userId: number; at: number }>();
  const TICKET_TTL_MS = 15 * 60 * 1000;
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
    miniapp = await startMiniappServer({
      logger: logger.child('miniapp'),
      baseUrl: config.miniappUrl,
      webhookPath,
      webhookHandler: webhookHandler ?? undefined,
      port: config.miniappPort,
      botToken: config.botToken,
      devMode: config.miniappDev,
      health: () => ({
        ok: true,
        storage: storage.stats(),
        db: storage.monitor.current(),
      }),
      getQuestionnaire: async (code, userId) => {
        const event = await events.findByCode(code);
        if (!event) return null;
        const [participant, profile] = await Promise.all([
          userId === null ? Promise.resolve(null) : participants.find(event.id, userId),
          userId === null ? Promise.resolve(null) : profiles.get(userId),
        ]);
        return {
          event: {
            code: event.code,
            title: event.title,
            startsAt: formatDateTime(event.startsAt, config.appTz),
            place: event.place,
          },
          fields: event.fields,
          me: {
            name: participant?.name ?? profile?.name ?? '',
            contact: participant?.contact ?? profile?.contact ?? '',
            status: participant?.status ?? 'going',
            answers: participant?.answers ?? {},
          },
        };
      },
      saveAnswers: async (submission) => {
        const event = await events.findByCode(submission.code);
        if (!event) return { ok: false, error: `Событие ${submission.code} не найдено` };
        const result = await participants.save({
          event,
          userId: submission.userId,
          name: submission.name,
          username: submission.username,
          contact: submission.contact,
          status: submission.status,
          answers: submission.answers,
        });
        if (!result.ok) {
          return { ok: false, error: result.error, fieldId: result.failedField.id };
        }
        if (submission.contact) await profiles.saveContact(submission.userId, submission.contact);

        const notification = registrationNotice(event, {
          name: result.participant.name,
          contact: result.participant.contact,
          statusLabel: STATUS_LABELS[result.participant.status],
          waitlisted: result.waitlisted,
          answers: result.participant.answers,
        });
        try {
          await notifier.sendToUser(event.organizerId, notification);
        } catch (error) {
          logger.warn('Не удалось уведомить организатора о заявке из мини-приложения', error);
        }
        logger.info(`Заявка из мини-приложения: событие ${event.code}, участник ${submission.userId}`);
        return { ok: true };
      },
      takeTicket: (ticket) => {
        // Не гасим сразу: при ошибке валидации организатор может исправить данные
        // и нажать «Сохранить» ещё раз, пока тикет не истёк.
        const owner = tickets.get(ticket);
        if (!owner) return null;
        if (Date.now() - owner.at > TICKET_TTL_MS) {
          tickets.delete(ticket);
          return null;
        }
        return owner;
      },
      consumeTicket: (ticket) => {
        tickets.delete(ticket);
      },
      getDraft: (userId) => readDraftQuestionnaire(deps, userId),
      onFieldsSaved: (userId, fields, answerMode, name) =>
        applyMiniappFields(deps, userId, fields, answerMode, name),
    });
    miniappBridge = {
      buildUrl: (ticket) => miniapp!.buildUrl(ticket),
      registerTicket: (ticket, owner) => {
        tickets.set(ticket, owner);
        miniapp!.registerTicket(ticket, owner);
      },
      takeTicket: (ticket) => {
        const owner = tickets.get(ticket);
        if (!owner) return null;
        if (Date.now() - owner.at > TICKET_TTL_MS) {
          tickets.delete(ticket);
          return null;
        }
        return owner;
      },
    };
    deps.miniapp = miniappBridge;
    logger.info(`Мини-приложение вопросов: ${config.miniappUrl} (локальный порт ${miniapp.port})`);
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

    let botInfo;
    try {
      botInfo = await bot.api.getMyInfo();
    } catch (error) {
      if (isCertificateError(error)) logger.error(certificateHint());
      throw error;
    }
    bot.botInfo = botInfo;
    logger.info(`Бот @${botInfo.username ?? 'unknown'} (id ${botInfo.user_id}), режим ${config.botMode}`);

    try {
      await bot.api.setMyCommands(BOT_COMMANDS);
    } catch (error) {
      logger.warn('Не удалось опубликовать подсказки команд, это не критично', error);
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
        // Связи нет — контейнер перезапустится (runit/compose) и попробует снова.
        throw new Error(`Не удалось подписаться на вебхук ${subscriptionUrl}`);
      }
      logger.info(`Подписка на ${subscriptionUrl} активна`);

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
