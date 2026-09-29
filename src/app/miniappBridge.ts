import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bot } from '@maxhub/max-bot-api';

import type { BotContext } from '../bot/context.js';
import type { AppDeps } from '../bot/deps.js';
import { applyMiniappFields, readDraftQuestionnaire } from '../bot/handlers/miniappSync.js';
import type { MiniappTicketStore } from '../bot/miniappTickets.js';
import type { Notifier } from '../bot/notifier.js';
import { registrationNotice } from '../bot/texts/registration/index.js';
import type { AppConfig } from '../config.js';
import type { Storage } from '../db/storage.js';
import { formatDateTime } from '../domain/datetime/index.js';
import { STATUS_LABELS } from '../domain/types.js';
import type { Logger } from '../logger.js';
import { startMiniappServer, type MiniappHandle } from '../miniapp/server.js';

/**
 * Мини-приложение конструктора вопросов: страница, анкета участника и приём
 * ответов из неё. Поднимается, только если задан MINIAPP_URL; вебхук MAX едет
 * тем же портом, поэтому наружу нужен один HTTPS-маршрут.
 *
 * Здесь же собирается «мост» для бота: ссылка на конструктор по одноразовой
 * подписи и приём сохранённых вопросов в текущий черновик мастера.
 */
export interface MiniappBridgeOptions {
  config: AppConfig;
  logger: Logger;
  storage: Storage;
  bot: Bot<BotContext>;
  notifier: Notifier;
  deps: AppDeps;
  /** Публичный HTTPS-адрес мини-приложения (он же указан в настройках бота). */
  miniappUrl: string;
  /** Одноразовые подписи конструктора: живут в хранилище сессий. */
  tickets: MiniappTicketStore;
  webhookPath?: string;
  webhookHandler?: (req: IncomingMessage, res: ServerResponse) => void;
}

export interface MiniappBridgeResult {
  handle: MiniappHandle;
  bridge: NonNullable<AppDeps['miniapp']>;
}

export const startMiniappBridge = async (
  options: MiniappBridgeOptions,
): Promise<MiniappBridgeResult> => {
  const { config, logger, storage, notifier, deps, miniappUrl, tickets, webhookPath, webhookHandler } = options;
  const { events, participants, profiles } = deps;

  const handle = await startMiniappServer({
    logger: logger.child('miniapp'),
    baseUrl: miniappUrl,
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
    takeTicket: tickets.take,
    getDraft: (ticket) => readDraftQuestionnaire(deps, ticket),
    onFieldsSaved: (ticket, fields, answerMode, name) =>
      applyMiniappFields(deps, ticket, fields, answerMode, name),
  });

  return {
    handle,
    bridge: {
      buildUrl: (ticket) => handle.buildUrl(ticket),
      registerTicket: tickets.register,
      takeTicket: tickets.take,
    },
  };
};
