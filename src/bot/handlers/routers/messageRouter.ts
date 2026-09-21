import { normalizeCode } from '../../../domain/ids.js';
import { eventCodeFromStartPayload, CB } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import { fallback, helpText, mainMenu } from '../../texts/common.js';
import { startCreateEvent } from '../drafts/createEvent.js';
import { startRegistration } from '../drafts/register.js';
import { showEventList, showMainMenu } from '../features/events.js';
import { tryAnswerFaqText } from '../features/faq.js';
import { showFaq } from '../features/faq.js';
import { showTemplates } from '../features/templates.js';
import { showDuties } from '../features/money.js';
import { showProfile } from '../features/profile.js';
import { userIdOf } from '../helpers.js';

/** Вход в бота: по ссылке-приглашению (payload) или обычный. */
export const handleBotStarted = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const code = eventCodeFromStartPayload(ctx.startPayload);
  if (code) {
    await startRegistration(ctx, deps, code);
    return;
  }
  await showMainMenu(ctx, deps);
};

/** Свободный текст: код события, вопрос из FAQ или подсказка с меню. */
export const handleMessage = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const input = ctx.message?.body.text?.trim() ?? '';

  if (!input) {
    await show(
      ctx,
      withKeyboard('Пришлите текст или воспользуйтесь кнопками ниже.', [[cb('В меню', CB.menuMain)]]),
    );
    return;
  }

  const code = normalizeCode(input);
  if (/^[A-Z0-9]{4,8}$/.test(code)) {
    const event = await deps.events.findByCode(code);
    if (event) {
      await startRegistration(ctx, deps, code);
      return;
    }
  }

  if (await tryAnswerFaqText(ctx, deps, input)) return;

  const events = await deps.events.listForUser(userIdOf(ctx));
  await show(ctx, fallback({ eventsCount: events.length }));
};

const wrap = (
  deps: AppDeps,
  scope: string,
  handler: (ctx: BotContext) => Promise<unknown>,
): ((ctx: BotContext) => Promise<void>) => {
  return async (ctx: BotContext) => {
    try {
      await handler(ctx);
    } catch (error) {
      deps.logger.error(`Ошибка в команде ${scope}`, error);
      await show(
        ctx,
        withKeyboard('Не получилось выполнить команду. Попробуйте ещё раз.', [[cb('В меню', CB.menuMain)]]),
      ).catch(() => undefined);
    }
  };
};

export const registerCommands = (bot: import('@maxhub/max-bot-api').Bot<BotContext>, deps: AppDeps): void => {
  bot.command('start', wrap(deps, 'start', async (ctx) => {
    const code = eventCodeFromStartPayload(ctx.startPayload);
    if (code) {
      await startRegistration(ctx, deps, code);
      return;
    }
    if (ctx.session) ctx.session.draft = null;
    await showMainMenu(ctx, deps);
  }));

  bot.command('help', wrap(deps, 'help', async (ctx) => {
    await show(ctx, helpText());
  }));

  bot.command('new', wrap(deps, 'new', async (ctx) => {
    await startCreateEvent(ctx, deps);
  }));

  bot.command('events', wrap(deps, 'events', async (ctx) => {
    await showEventList(ctx, deps);
  }));

  bot.command('templates', wrap(deps, 'templates', async (ctx) => {
    await showTemplates(ctx, deps);
  }));

  bot.command('faq', wrap(deps, 'faq', async (ctx) => {
    await showFaq(ctx, deps);
  }));

  bot.command('duties', wrap(deps, 'duties', async (ctx) => {
    await showDuties(ctx, deps);
  }));

  bot.command('profile', wrap(deps, 'profile', async (ctx) => {
    await showProfile(ctx, deps);
  }));

  bot.command('cancel', wrap(deps, 'cancel', async (ctx) => {
    if (ctx.session) ctx.session.draft = null;
    await showMainMenu(ctx, deps);
  }));

  bot.command(/^join\s+(.+)$/i, wrap(deps, 'join', async (ctx) => {
    const code = normalizeCode(ctx.match?.[1] ?? '');
    if (!code) {
      await show(ctx, withKeyboard('Укажите код события: /join A7K2Q', [[cb('В меню', CB.menuMain)]]));
      return;
    }
    await startRegistration(ctx, deps, code);
  }));

  bot.command('join', wrap(deps, 'join-hint', async (ctx) => {
    await show(
      ctx,
      withKeyboard('Формат: /join КОД, например /join A7K2Q. Код показывает организатор события.', [
        [cb('В меню', CB.menuMain)],
      ]),
    );
  }));
};

export { mainMenu };
