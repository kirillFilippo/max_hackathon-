import type { Bot } from '@maxhub/max-bot-api';

import type { BotContext } from '../bot/context.js';
import { botInfoPlaceholder, fetchBotInfo, publishCommands } from '../bot/botInfo.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';

/** Команда, которую бот публикует в MAX. */
export interface BotCommand {
  name: string;
  description: string;
}

export interface AnnouncementHandle {
  /** Останавливает повторные попытки знакомства. */
  stop(): void;
}

/**
 * Знакомство с ботом при старте: `GET /me`, заглушка имени и публикация команд.
 *
 * Знакомство не должно мешать запуску: при обрыве связи или DNS MAX может не
 * ответить, и раньше это оставляло бота без подписки на вебхук. Поэтому при
 * неудаче ставим заглушку (SDK падает на `botInfo.username` в long polling) и
 * повторяем попытку в фоне: имя бота нужно для ссылок-приглашений.
 */
export const announceBot = async (
  bot: Bot<BotContext>,
  config: AppConfig,
  logger: Logger,
  commands: BotCommand[],
): Promise<AnnouncementHandle> => {
  const info = await fetchBotInfo(bot.api, logger);
  bot.botInfo = info ?? botInfoPlaceholder(config.botUsername);

  if (info) {
    logger.info(`Бот @${info.username ?? 'unknown'} (id ${info.user_id}), режим ${config.botMode}`);
    await publishCommands(bot.api, commands, logger);
    return { stop: () => undefined };
  }

  let timer: NodeJS.Timeout | null = setInterval(() => {
    void (async () => {
      const retry = await fetchBotInfo(bot.api, logger);
      if (!retry) return;
      bot.botInfo = retry;
      if (timer) clearInterval(timer);
      timer = null;
      logger.info(`Данные бота получены: @${retry.username ?? 'unknown'}`);
      await publishCommands(bot.api, commands, logger);
    })();
  }, config.webhookCheckSeconds * 1000);
  timer.unref?.();

  return {
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
};
