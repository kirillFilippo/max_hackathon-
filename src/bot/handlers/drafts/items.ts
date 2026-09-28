import { CB } from '../../callbacks.js';
import { show, userText, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import type { DraftState } from '../../session.js';
import { addItemsPrompt, itemPricePrompt, myItems, reserveNumbersPrompt, reserveResult, shoppingList } from '../../texts/shopping.js';
import { findEventByIdOrNotify, findEventOrNotify, menuRow, userIdOf } from '../helpers.js';
import { reserveByNumbersText } from '../features/shopping.js';

export type ItemsAddDraft = Extract<DraftState, { kind: 'items-add' }>;
export type ItemReserveDraft = Extract<DraftState, { kind: 'item-reserve' }>;
export type ItemPriceDraft = Extract<DraftState, { kind: 'item-price' }>;

/** Организатор добавляет позиции: одна строка — один предмет. */
export const startAddItems = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  if (event.organizerId !== userIdOf(ctx)) {
    await show(ctx, withKeyboard('Добавлять позиции может только организатор.', menuRow));
    return;
  }
  if (!ctx.session) return;
  ctx.session.draft = { kind: 'items-add', step: 'titles', eventId: event.id, eventCode: event.code };
  await show(ctx, addItemsPrompt(event));
};

export const handleItemsAddDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: ItemsAddDraft,
): Promise<boolean> => {
  const input = userText(ctx);
  const event = await findEventByIdOrNotify(ctx, deps, draft.eventId);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    return true;
  }

  const titles = input
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 0);

  if (titles.length === 0) {
    await show(ctx, addItemsPrompt(event));
    return true;
  }

  await deps.items.add(event.id, titles);
  if (ctx.session) ctx.session.draft = null;
  const items = await deps.items.list(event.id);
  await show(ctx, shoppingList(event, items, { isOrganizer: true, userId: userIdOf(ctx) }));
  return true;
};

/** Участник отправляет номера позиций списком. */
export const startReserveNumbers = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  const items = await deps.items.list(event.id);
  if (items.length === 0) {
    await show(ctx, withKeyboard('Список покупок пока пуст.', menuRow));
    return;
  }
  if (!ctx.session) return;
  ctx.session.draft = { kind: 'item-reserve', step: 'numbers', eventId: event.id, eventCode: event.code };
  await show(ctx, reserveNumbersPrompt(event, items));
};

export const handleItemReserveDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: ItemReserveDraft,
): Promise<boolean> => {
  const event = await findEventByIdOrNotify(ctx, deps, draft.eventId);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    return true;
  }
  if (ctx.session) ctx.session.draft = null;
  const input = userText(ctx);
  if (!input) {
    const items = await deps.items.list(event.id);
    await show(ctx, reserveNumbersPrompt(event, items));
    return true;
  }
  await reserveByNumbersText(ctx, deps, event, input);
  return true;
};
