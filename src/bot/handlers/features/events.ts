import type { DosugEvent } from '../../../domain/types.js';
import { CB, cbEventCard, cbEventPeople } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, text, withKeyboard } from '../../message.js';
import { mainMenu } from '../../texts/common.js';
import {
  eventDetails,
  eventLinkText,
  eventList as eventListView,
  invitationCard,
  organizerEventCard,
  participantEventCard,
  participantsPanel,
} from '../../texts/event.js';
import { confirmReminder } from '../../texts/registration.js';
import { botUsernameOf, menuRow, notifyParticipants, requireUser, userIdOf } from '../helpers.js';

export const eventViewOptions = (ctx: BotContext, deps: AppDeps): { tz: string; botUsername?: string } => ({
  tz: deps.config.appTz,
  botUsername: botUsernameOf(ctx, deps),
});

export const showMainMenu = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const user = ctx.user;
  const events = user ? await deps.events.listForUser(user.user_id) : [];
  const duties = user ? await deps.settlements.listForDebtor(user.user_id) : [];
  await show(ctx, mainMenu({ hasEvents: events.length > 0, hasDuties: duties.length > 0 }));
};

export const showEventList = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const events = await deps.events.listForUser(userIdOf(ctx));
  await show(ctx, eventListView(events, eventViewOptions(ctx, deps)));
};

const requireOwnEvent = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<DosugEvent | null> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return null;
  }
  if (event.organizerId !== userIdOf(ctx)) {
    await show(ctx, withKeyboard('Это событие создал другой организатор, управлять им нельзя.', menuRow));
    return null;
  }
  return event;
};

export const showEventCard = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return;
  }
  if (ctx.session) ctx.session.lastEventCode = event.code;
  const [participants, items] = await Promise.all([
    deps.participants.listByEvent(event.id),
    deps.items.list(event.id),
  ]);
  await show(
    ctx,
    organizerEventCard(event, deps.events.stats(event, participants), eventViewOptions(ctx, deps), items.length),
  );
};

export const showParticipants = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await requireOwnEvent(ctx, deps, code);
  if (!event) return;
  const participants = await deps.participants.listByEvent(event.id);
  await show(ctx, participantsPanel(event, participants, eventViewOptions(ctx, deps)));
};

/**
 * «Доп. информация»: адрес, карта, описание, анкета, состав и список покупок.
 * Карту показываем только здесь и в напоминании за час — чтобы ссылка не терялась.
 */
export const showEventDetails = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return;
  }
  const [participants, items] = await Promise.all([
    deps.participants.listByEvent(event.id),
    deps.items.list(event.id),
  ]);
  await show(ctx, eventDetails(event, participants, items, eventViewOptions(ctx, deps)));
};

export const showInviteLink = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return;
  }
  const options = eventViewOptions(ctx, deps);
  const linkUrl = deps.events.inviteLink(event, options.botUsername);
  await show(
    ctx,
    withKeyboard(eventLinkText(event, linkUrl, event.code), [
      [cb('Участники', cbEventPeople(event.code)), cb('К событию', cbEventCard(event.code))],
    ]),
  );
};

export const closeEvent = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await requireOwnEvent(ctx, deps, code);
  if (!event) return;
  await deps.events.close(event.id);
  const notified = await notifyParticipants(
    deps,
    event,
    text(`Событие «${event.title}» закрыто организатором. Спасибо всем, кто пришёл.`),
  );
  await show(
    ctx,
    withKeyboard(`Событие закрыто. Уведомлений отправлено: ${notified}.`, [
      [cb('Мои события', CB.menuEvents)],
    ]),
  );
};

/** Мгновенное напоминание всем, кроме отказавшихся. */
export const remindNow = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await requireOwnEvent(ctx, deps, code);
  if (!event) return;
  const sent = await notifyParticipants(
    deps,
    event,
    confirmReminder(event, { tz: deps.config.appTz }),
  );
  await show(
    ctx,
    withKeyboard(`Напоминание отправлено: ${sent} участникам.`, [
      [cb('Участники', cbEventPeople(event.code)), cb('К событию', cbEventCard(event.code))],
    ]),
  );
};

/** Кнопка «К событию» из карточки участника — открывает карточку для просмотра. */
export const openEventForParticipant = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return;
  }
  const user = requireUser(ctx);
  const [participant, items] = await Promise.all([
    deps.participants.find(event.id, user.user_id),
    deps.items.list(event.id),
  ]);
  if (participant) {
    await show(ctx, participantEventCard(event, participant, eventViewOptions(ctx, deps), items.length));
    return;
  }
  const stats = deps.events.stats(event, await deps.participants.listByEvent(event.id));
  await show(ctx, invitationCard(event, stats, eventViewOptions(ctx, deps)));
};
