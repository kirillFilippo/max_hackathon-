import type { DosugEvent } from '../../../domain/types.js';
import { parseItemNumbers } from '../../../services/itemService.js';
import { cbEventCard, cbShopShow } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import { listReadyNotification, myItems, reserveResult, shoppingList } from '../../texts/shopping.js';
import {
  findEventOrNotify,
  menuRow,
  notifyParticipants,
  participantNameFor,
  requireUser,
  userIdOf,
} from '../helpers.js';

/** Помнит, что пользователь смотрел список покупок: контекст для ввода номеров текстом. */
const rememberShop = (ctx: BotContext, code: string): void => {
  if (ctx.session) ctx.session.lastShopEventCode = code;
};

export const showShoppingList = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  rememberShop(ctx, event.code);
  const items = await deps.items.list(event.id);
  await show(
    ctx,
    shoppingList(event, items, { isOrganizer: event.organizerId === userIdOf(ctx), userId: userIdOf(ctx) }),
  );
};

export const showMyItems = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  rememberShop(ctx, event.code);
  const items = await deps.items.mine(event.id, userIdOf(ctx));
  await show(ctx, myItems(event, items));
};

/** Быстрое бронирование по кнопке. */
export const takeItem = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
  itemId: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  rememberShop(ctx, event.code);
  const user = requireUser(ctx);
  const name = await participantNameFor(ctx, deps, event.id);
  const result = await deps.items.reserveItem(event, itemId, user.user_id, name);
  const items = await deps.items.list(event.id);

  const outcome = {
    reserved: result.reserved ? items.filter((item) => item.id === itemId) : [],
    taken: result.takenBy
      ? [{ item: items.find((item) => item.id === itemId)!, byName: result.takenBy }].filter((entry) => entry.item)
      : [],
    alreadyMine: result.alreadyMine ? items.filter((item) => item.id === itemId) : [],
    unknown: [],
    free: items.filter((item) => item.reservation === null),
  };
  await show(ctx, reserveResult(event, outcome, items, userIdOf(ctx)));
};

export const releaseItem = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
  itemId: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  await deps.items.release(itemId, userIdOf(ctx));
  const items = await deps.items.mine(event.id, userIdOf(ctx));
  await show(ctx, myItems(event, items));
};

/** Участник отправил номера позиций списком. */
export const reserveByNumbersText = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  input: string,
): Promise<void> => {
  const numbers = parseItemNumbers(input);
  if (numbers.length === 0) {
    const items = await deps.items.list(event.id);
    await show(ctx, shoppingList(event, items, { isOrganizer: false, userId: userIdOf(ctx) }));
    return;
  }
  const user = requireUser(ctx);
  const name = await participantNameFor(ctx, deps, event.id);
  const outcome = await deps.items.reserveByNumbers(event, user.user_id, name, numbers);
  const items = await deps.items.list(event.id);
  await show(ctx, reserveResult(event, outcome, items, userIdOf(ctx)));
};

/** Рассылка участникам: список покупок объявлен. */
export const notifyShoppingList = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  if (event.organizerId !== userIdOf(ctx)) {
    await show(ctx, withKeyboard('Рассылать список может только организатор.', menuRow));
    return;
  }
  const items = await deps.items.list(event.id);
  const sent = await notifyParticipants(
    deps,
    event,
    listReadyNotification(event, items, deps.config.appTz),
  );
  await show(
    ctx,
    withKeyboard(`Список отправлен ${sent} участникам.`, [
      [cb('Список покупок', cbShopShow(event.code)), cb('К событию', cbEventCard(event.code))],
    ]),
  );
};
