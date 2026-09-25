import { normalizeCode } from '../../../domain/ids.js';
import { CB } from '../../callbacks.js';
import { eventCodeFromStartPayload, startCommandPayload } from '../../../domain/links.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import { fallback, helpText, mainMenu } from '../../texts/common.js';
import { startCreateEvent } from '../drafts/createEvent.js';
import { startRegistration } from '../drafts/register.js';
import { debugCreateEvent, debugReceiveEvent, DEBUG_CREATE_COMMAND, DEBUG_RECEIVE_COMMAND } from '../features/debug.js';
import { showEventList, showMainMenu } from '../features/events.js';
import { tryAnswerFaqText } from '../features/faq.js';
import { showFaq } from '../features/faq.js';
import { showTemplates } from '../features/templates.js';
import { showDuties } from '../features/money.js';
import { showProfile } from '../features/profile.js';
import { userIdOf, withErrorHandling } from '../helpers.js';

/** Вход в бота: по ссылке-приглашению (payload) или обычный. */
export const handleBotStarted = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  await handleStart(ctx, deps, ctx.startPayload ?? null);
};

/**
 * Единая обработка входа: и для `bot_started`, и для команды `/start`.
 * Повторную доставку того же входа отсекает дедупликатор (см. `bot/middleware/dedupe`),
 * поэтому здесь нет своей отметки «уже отвечали».
 */
export const handleStart = async (
  ctx: BotContext,
  deps: AppDeps,
  payload: string | null,
): Promise<void> => {
  const code = eventCodeFromStartPayload(payload);
  if (code) {
    await startRegistration(ctx, deps, code);
    return;
  }

  if (ctx.session) ctx.session.draft = null;
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

  // `/start` и `/start@Бот`: команда уже обработана выше, но у разных клиентов
  // MAX текст может прийти и сюда — тогда отвечаем тем же путём, без дублей.
  const startPayload = startCommandPayload(input);
  if (startPayload !== null) {
    await handleStart(ctx, deps, startPayload === '' ? null : startPayload);
    return;
  }

  // Отладочные команды текстом: клиенты MAX могут прислать их и как сообщение.
  const debug = new RegExp(`^/(${DEBUG_CREATE_COMMAND}|${DEBUG_RECEIVE_COMMAND})(?:@[\\w_]+)?$`, 'i').exec(input);
  if (debug) {
    const command = debug[1]!.toLowerCase();
    if (command === DEBUG_CREATE_COMMAND) await debugCreateEvent(ctx, deps);
    else await debugReceiveEvent(ctx, deps);
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
): ((ctx: BotContext) => Promise<void>) =>
  withErrorHandling(deps, scope, handler, {
    kind: 'команде',
    message: 'Не получилось выполнить команду. Попробуйте ещё раз.',
  });

export const registerCommands = (bot: import('@maxhub/max-bot-api').Bot<BotContext>, deps: AppDeps): void => {
  bot.command('start', wrap(deps, 'start', async (ctx) => {
    await handleStart(ctx, deps, ctx.startPayload ?? null);
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

  if (deps.config.debugCommands) {
    bot.command(DEBUG_CREATE_COMMAND, wrap(deps, DEBUG_CREATE_COMMAND, async (ctx) => {
      await debugCreateEvent(ctx, deps);
    }));

    bot.command(DEBUG_RECEIVE_COMMAND, wrap(deps, DEBUG_RECEIVE_COMMAND, async (ctx) => {
      await debugReceiveEvent(ctx, deps);
    }));
  }

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
