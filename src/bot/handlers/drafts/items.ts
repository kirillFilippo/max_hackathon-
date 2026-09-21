import { parsePriceKopecks } from '../../../domain/money.js';
import { CB } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import type { DraftState } from '../../session.js';
import { addItemsPrompt, itemPricePrompt, myItems, reserveNumbersPrompt, reserveResult, shoppingList } from '../../texts/shopping.js';
import { menuRow, userIdOf } from '../helpers.js';
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
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return;
  }
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
  const input = ctx.message?.body.text ?? '';
  const event = await deps.events.findById(draft.eventId);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    await show(ctx, withKeyboard('Событие не найдено.', menuRow));
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
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return;
  }
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
  const event = await deps.events.findById(draft.eventId);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    await show(ctx, withKeyboard('Событие не найдено.', menuRow));
    return true;
  }
  if (ctx.session) ctx.session.draft = null;
  const input = ctx.message?.body.text?.trim() ?? '';
  if (!input) {
    const items = await deps.items.list(event.id);
    await show(ctx, reserveNumbersPrompt(event, items));
    return true;
  }
  await reserveByNumbersText(ctx, deps, event, input);
  return true;
};

/** Участник указывает фактическую сумму за свою позицию. */
export const startItemPrice = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
  itemId: string,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return;
  }
  const item = await deps.items.find(itemId);
  if (!item || item.eventId !== event.id) {
    await show(ctx, withKeyboard('Позиция не найдена.', menuRow));
    return;
  }
  if (item.reservation?.userId !== userIdOf(ctx)) {
    await show(ctx, withKeyboard('Эта позиция забронирована другим участником.', menuRow));
    return;
  }
  if (!ctx.session) return;
  ctx.session.draft = {
    kind: 'item-price',
    step: 'amount',
    itemId,
    eventCode: event.code,
    itemTitle: item.title,
  };
  await show(ctx, itemPricePrompt(item));
};

export const handleItemPriceDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: ItemPriceDraft,
): Promise<boolean> => {
  const event = await deps.events.findByCode(draft.eventCode);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    await show(ctx, withKeyboard('Событие не найдено.', menuRow));
    return true;
  }
  const input = ctx.message?.body.text?.trim() ?? '';
  if (!input) {
    const item = await deps.items.find(draft.itemId);
    if (item) await show(ctx, itemPricePrompt(item));
    return true;
  }

  const parsed = parsePriceKopecks(input);
  if (parsed === undefined) {
    await show(ctx, withKeyboard('Не понял сумму. Напишите число, 0 — отказаться от позиции.', [
      [cb('Отмена', CB.draftCancel)],
    ]));
    return true;
  }

  if (ctx.session) ctx.session.draft = null;

  if (parsed === null) {
    await deps.items.release(draft.itemId, userIdOf(ctx));
    const items = await deps.items.mine(event.id, userIdOf(ctx));
    await show(ctx, myItems(event, items));
    return true;
  }

  const updated = await deps.items.setPaidAmount(draft.itemId, userIdOf(ctx), parsed);
  const items = await deps.items.mine(event.id, userIdOf(ctx));
  await show(ctx, myItems(event, items));
  if (updated) {
    const view = await deps.settlements.view(event);
    const hint = view.settlement.totalKopecks > 0
      ? `Общие траты: ${view.settlement.totalKopecks / 100} ₽ на ${view.settlement.participantsCount} участников.`
      : '';
    if (hint) {
      await show(
        ctx,
        withKeyboard(hint, [[cb('Расчёты', `money:show:${event.code}`)]]),
      );
    }
  }
  return true;
};

export { reserveResult };
