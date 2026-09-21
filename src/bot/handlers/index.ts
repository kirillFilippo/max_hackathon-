import type { Bot } from '@maxhub/max-bot-api';
import { session } from '@maxhub/max-bot-api';

import { show } from '../context.js';
import type { BotContext } from '../context.js';
import type { PgSessionStore } from '../../db/sessions.js';
import type { AppDeps } from '../deps.js';
import { cb, withKeyboard } from '../message.js';
import type { BotSession } from '../session.js';
import { withErrorHandling } from './helpers.js';
import { handleCallback } from './routers/callbackRouter.js';
import { handleDraft } from './routers/draftRouter.js';
import { handleBotStarted, handleMessage, registerCommands } from './routers/messageRouter.js';

/**
 * Порядок важен:
 * 1. session() — подтягивает черновики мастеров из БД;
 * 2. команды — работают даже внутри активного шага (/cancel, /help);
 * 3. handleDraft — перехватывает текст и кнопки активного мастера;
 * 4. остальные события — карточки, покупки, расчёты, FAQ.
 */
export const registerHandlers = (
  bot: Bot<BotContext>,
  deps: AppDeps,
  sessionStore: PgSessionStore<BotSession>,
): void => {
  bot.use(
    session<BotSession, BotContext>({
      store: sessionStore,
      defaultSession: () => ({}),
    }),
  );

  registerCommands(bot, deps);

  bot.use(async (ctx, next) => {
    try {
      const handled = await handleDraft(ctx, deps);
      if (handled) return undefined;
      return await next();
    } catch (error) {
      deps.logger.error('Ошибка в мастере', error);
      try {
        await show(
          ctx,
          withKeyboard('Не получилось выполнить шаг. Попробуйте ещё раз или начните заново.', [
            [cb('В меню', 'menu:main')],
          ]),
        );
      } catch (secondary) {
        deps.logger.error('Не удалось отправить сообщение об ошибке', secondary);
      }
      return undefined;
    }
  });

  bot.on('bot_started', withErrorHandling(deps, 'bot_started', (ctx) => handleBotStarted(ctx, deps)));
  bot.on('message_callback', withErrorHandling(deps, 'callback', (ctx) => handleCallback(ctx, deps)));
  bot.on('message_created', withErrorHandling(deps, 'message', (ctx) => handleMessage(ctx, deps)));
};
