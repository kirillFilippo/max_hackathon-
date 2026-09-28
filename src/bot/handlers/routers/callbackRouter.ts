import { parseCallback } from '../../callbacks.js';
import type { BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { handleEvent } from './callbacks/event.js';
import { handleFaq } from './callbacks/faq.js';
import { handleMenu } from './callbacks/menu.js';
import { handleMoney, handleTransfer } from './callbacks/money.js';
import { handleProfile } from './callbacks/profile.js';
import { handleQuestions, handleApp } from './callbacks/questions.js';
import { handleRegistration } from './callbacks/registration.js';
import { handleItem, handleShopping } from './callbacks/shopping.js';
import { handleTemplate } from './callbacks/templates.js';

/**
 * Обработка кнопок вне активного мастера.
 *
 * Раньше это был один `switch` на триста строк; теперь каждое семейство кнопок
 * (`ev:*`, `shop:*`, `tr:*` …) живёт в своём модуле рядом, а здесь остаётся
 * только таблица «префикс payload → обработчик». Добавить новую кнопку — значит
 * дописать функцию в подходящем файле и строку в таблице.
 */
type CallbackHandler = (ctx: BotContext, deps: AppDeps, args: string[]) => Promise<void>;

const FAMILIES: Record<string, CallbackHandler> = {
  menu: handleMenu,
  ev: handleEvent,
  shop: handleShopping,
  item: handleItem,
  money: handleMoney,
  tr: handleTransfer,
  profile: handleProfile,
  tpl: handleTemplate,
  reg: handleRegistration,
  q: handleQuestions,
  app: handleApp,
  faq: handleFaq,
};

export const handleCallback = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  if (ctx.updateType !== 'message_callback') return;
  const { action, args } = parseCallback(ctx.callback?.payload ?? '');
  const handler = FAMILIES[action];
  if (!handler) return;
  await handler(ctx, deps, args);
};
