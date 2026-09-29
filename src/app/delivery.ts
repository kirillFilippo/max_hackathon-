import { Webhook, type Bot } from '@maxhub/max-bot-api';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { BotContext } from '../bot/context.js';
import {
  ensureSubscription,
  startSubscriptionWatchdog,
  type WatchdogHandle,
} from '../bot/subscriptionWatchdog.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { certificateHint, isCertificateError } from '../tls.js';

/** Обработчик апдейтов MAX из SDK: один маршрут и для вебхука, и для мини-приложения. */
export type WebhookCallback = (req: IncomingMessage, res: ServerResponse) => void;

export interface DeliveryOptions {
  bot: Bot<BotContext>;
  config: AppConfig;
  logger: Logger;
  /** Разобранный `WEBHOOK_URL`; null — работаем long polling. */
  webhookUrl: URL | null;
  webhookPath?: string;
  webhookHandler: WebhookCallback | null;
  /** Порт мини-приложения, если оно уже слушает порт: тогда свой сервер не поднимаем. */
  miniappPort: number | null;
}

export interface DeliveryHandle {
  stop(): Promise<void>;
}

/**
 * Доставка обновлений от MAX: вебхук или long polling.
 *
 * Вынесено из `app.ts`, потому что здесь живут три разные заботы: подписка на
 * вебхук, свой HTTP-сервер (если мини-приложение выключено) и сторож подписки,
 * который лечит самый частый отказ домашнего стенда — «процесс жив, `/health`
 * отвечает, сообщения не идут».
 */
export const startDelivery = async (options: DeliveryOptions): Promise<DeliveryHandle> => {
  const { bot, config, logger, webhookUrl, webhookPath, webhookHandler, miniappPort } = options;
  let watchdog: WatchdogHandle | null = null;
  let ownServer: Server | null = null;

  const stop = async (): Promise<void> => {
    watchdog?.stop();
    watchdog = null;
    bot.stopPolling();
    try {
      await bot.stopWebhook();
    } catch {
      // Вебхук мог быть не запущен.
    }
    if (ownServer) {
      const server = ownServer;
      ownServer = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };

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
      logger.warn(`Не удалось подписаться на ${subscriptionUrl} — повторю при восстановлении связи`);
    } else {
      logger.info(`Подписка на ${subscriptionUrl} активна`);
    }

    if (miniappPort !== null) {
      logger.info(`Webhook обслуживает сервер мини-приложения на порту ${miniappPort}`);
    } else {
      const server = createServer((req, res) => webhookHandler(req, res));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.webhookPort, '0.0.0.0', () => resolve());
      });
      ownServer = server;
      logger.info(`Webhook слушает порт ${config.webhookPort}`);
    }

    // Домашний интернет рвётся: следим, что MAX по-прежнему шлёт обновления нам.
    watchdog = startSubscriptionWatchdog({
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
    logger.info('Long polling запущен');
  }

  return { stop };
};
