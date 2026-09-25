import { formatRub } from '../../../domain/money.js';
import type { DosugEvent, TransferRequest } from '../../../domain/types.js';
import { cbEventCard, cbMoneyShow } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import {
  detailsForwarded,
  dutiesPanel,
  inPersonForwarded,
  paidForwarded,
  paymentBankPrompt,
  receivedNotice,
  settlementPanel,
  transferDebtorCard,
} from '../../texts/money.js';
import { menuRow, sendToUser, userIdOf } from '../helpers.js';

const loadEvent = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<DosugEvent | null> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
    return null;
  }
  return event;
};

const nameResolver = (participants: Array<{ userId: number; name: string }>) => {
  const map = new Map(participants.map((participant) => [participant.userId, participant.name]));
  return (userId: number): string => map.get(userId) ?? `id${userId}`;
};

/** Панель расчётов по событию. */
export const showSettlement = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await loadEvent(ctx, deps, code);
  if (!event) return;
  const view = await deps.settlements.view(event);
  const requests = await deps.settlements.listByEvent(event.id);
  await show(
    ctx,
    settlementPanel(view, requests, {
      tz: deps.config.appTz,
      isOrganizer: event.organizerId === userIdOf(ctx),
      nameOf: nameResolver(view.participants),
    }),
  );
};

/** Создаёт запросы на перевод и рассылает должникам, кому и сколько они должны. */
export const requestTransfers = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await loadEvent(ctx, deps, code);
  if (!event) return;
  if (event.organizerId !== userIdOf(ctx)) {
    await show(ctx, withKeyboard('Создавать запросы может только организатор.', menuRow));
    return;
  }

  const result = await deps.settlements.requestTransfers(event);
  const view = await deps.settlements.view(event);

  let sent = 0;
  for (const request of result.toNotify) {
    const creditor = await deps.profiles.get(request.toUserId);
    const debtor = await deps.profiles.get(request.fromUserId);
    const paidItems = view.items
      .filter((item) => item.reservation?.userId === request.fromUserId && item.reservation.paidKopecks != null)
      .map((item) => item.title);

    const delivered = await sendToUser(
      deps,
      request.fromUserId,
      transferDebtorCard({
        request,
        event,
        creditorName: creditor?.name ?? `id${request.toUserId}`,
        items: paidItems,
        profile: debtor,
        tz: deps.config.appTz,
      }),
    );
    if (delivered) sent += 1;
  }

  await show(
    ctx,
    withKeyboard(
      [
        `Запросы на перевод отправлены: ${sent}.`,
        result.alreadyNotified > 0
          ? `Уже получали карточку: ${result.alreadyNotified} — повторно не пишу, чтобы не дублировать.`
          : '',
        '',
        result.toNotify.length === 0
          ? 'Новых расчётов нет: переводы не требуются или все уже закрыты.'
          : `Всего в расчёте: ${formatRub(result.totalKopecks)}.`,
      ].join('\n'),
      [[cb('Обновить', cbMoneyShow(event.code)), cb('К событию', cbEventCard(event.code))]],
    ),
  );
};

/**
 * Должник нажал «Перевести и отправить реквизиты». Если реквизиты уже сохранены
 * в профиле — отправляем сразу, иначе запускаем короткий диалог.
 */
export const startTransferDetails = async (
  ctx: BotContext,
  deps: AppDeps,
  requestId: string,
): Promise<void> => {
  const request = await deps.settlements.find(requestId);
  if (!request) {
    await show(ctx, withKeyboard('Запрос не найден.', menuRow));
    return;
  }
  if (request.fromUserId !== userIdOf(ctx)) {
    await show(ctx, withKeyboard('Этот расчёт относится к другому участнику.', menuRow));
    return;
  }

  const profile = await deps.profiles.get(userIdOf(ctx));
  if (profile && profile.bankName.trim() && profile.paymentHandle.trim()) {
    await applyTransferDetails(ctx, deps, requestId, profile.bankName, profile.paymentHandle);
    return;
  }

  if (!ctx.session) return;
  ctx.session.draft = { kind: 'payment-details', step: 'bank', requestId };
  await show(ctx, paymentBankPrompt(request.amountKopecks));
};

/** Сохраняет реквизиты, передаёт их получателю и обновляет карточку должника. */
export const applyTransferDetails = async (
  ctx: BotContext,
  deps: AppDeps,
  requestId: string,
  bankName: string,
  handle: string,
): Promise<void> => {
  const applied = await deps.settlements.applyDetails(requestId, userIdOf(ctx), bankName, handle);
  if (!applied) {
    await show(ctx, withKeyboard('Не удалось сохранить реквизиты: запрос не найден.', menuRow));
    return;
  }
  const event = await deps.events.findById(applied.request.eventId);
  if (event) {
    await sendToUser(
      deps,
      applied.request.toUserId,
      detailsForwarded({
        event,
        debtorName: (await deps.profiles.get(applied.request.fromUserId))?.name ?? 'Участник',
        amountKopecks: applied.request.amountKopecks,
        bankName,
        handle,
        requestId: applied.request.id,
      }),
    );
    await showDebtorCard(ctx, deps, applied.request);
  }
};

/** «Отдам при встрече». */
export const markTransferInPerson = async (
  ctx: BotContext,
  deps: AppDeps,
  requestId: string,
): Promise<void> => {
  const updated = await deps.settlements.markInPerson(requestId, userIdOf(ctx));
  if (!updated) {
    await show(ctx, withKeyboard('Запрос не найден.', menuRow));
    return;
  }
  const event = await deps.events.findById(updated.eventId);
  if (event) {
    await sendToUser(
      deps,
      updated.toUserId,
      inPersonForwarded({
        event,
        debtorName: (await deps.profiles.get(updated.fromUserId))?.name ?? 'Участник',
        amountKopecks: updated.amountKopecks,
        requestId: updated.id,
      }),
    );
    await showDebtorCard(ctx, deps, updated);
  }
};

/** «Уже перевёл». */
export const markTransferPaid = async (
  ctx: BotContext,
  deps: AppDeps,
  requestId: string,
): Promise<void> => {
  const updated = await deps.settlements.markPaid(requestId, userIdOf(ctx));
  if (!updated) {
    await show(ctx, withKeyboard('Запрос не найден.', menuRow));
    return;
  }
  const event = await deps.events.findById(updated.eventId);
  if (event) {
    await sendToUser(
      deps,
      updated.toUserId,
      paidForwarded({
        event,
        debtorName: (await deps.profiles.get(updated.fromUserId))?.name ?? 'Участник',
        amountKopecks: updated.amountKopecks,
        requestId: updated.id,
      }),
    );
    await showDebtorCard(ctx, deps, updated);
  }
};

/** Получатель подтвердил получение денег. */
export const markTransferReceived = async (
  ctx: BotContext,
  deps: AppDeps,
  requestId: string,
): Promise<void> => {
  const updated = await deps.settlements.markReceived(requestId, userIdOf(ctx));
  if (!updated) {
    await show(ctx, withKeyboard('Запрос не найден или закрыть его может только получатель.', menuRow));
    return;
  }
  const event = await deps.events.findById(updated.eventId);
  if (!event) return;
  await sendToUser(
    deps,
    updated.fromUserId,
    receivedNotice({
      event,
      creditorName: (await deps.profiles.get(updated.toUserId))?.name ?? 'Получатель',
      amountKopecks: updated.amountKopecks,
    }),
  );
  await show(
    ctx,
    withKeyboard(
      `Расчёт закрыт: ${(await deps.profiles.get(updated.fromUserId))?.name ?? 'участник'} — ${formatRub(updated.amountKopecks)}.`,
      [[cb('Расчёты', cbMoneyShow(event.code)), cb('К событию', cbEventCard(event.code))]],
    ),
  );
};

const showDebtorCard = async (
  ctx: BotContext,
  deps: AppDeps,
  request: TransferRequest,
): Promise<void> => {
  const event = await deps.events.findById(request.eventId);
  if (!event) return;
  const view = await deps.settlements.view(event);
  const creditor = await deps.profiles.get(request.toUserId);
  const profile = await deps.profiles.get(request.fromUserId);
  const items = view.items
    .filter((item) => item.reservation?.userId === request.fromUserId)
    .map((item) => item.title);
  await show(
    ctx,
    transferDebtorCard({
      request,
      event,
      creditorName: creditor?.name ?? `id${request.toUserId}`,
      items,
      profile,
      tz: deps.config.appTz,
    }),
  );
};

/** Раздел «Мои расчёты»: долги пользователя и то, что должны ему. */
export const showDuties = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const userId = userIdOf(ctx);
  const [debtsRaw, creditsRaw] = await Promise.all([
    deps.settlements.listForDebtor(userId),
    deps.settlements.listForCreditor(userId),
  ]);

  const eventCache = new Map<string, DosugEvent | null>();
  const loadEventCached = async (id: string): Promise<DosugEvent | null> => {
    if (!eventCache.has(id)) eventCache.set(id, await deps.events.findById(id));
    return eventCache.get(id) ?? null;
  };

  const debts = [];
  for (const request of debtsRaw) {
    const event = await loadEventCached(request.eventId);
    if (!event) continue;
    debts.push({
      request,
      event,
      creditorName: (await deps.profiles.get(request.toUserId))?.name ?? `id${request.toUserId}`,
    });
  }
  const credits = [];
  for (const request of creditsRaw) {
    const event = await loadEventCached(request.eventId);
    if (!event) continue;
    credits.push({
      request,
      event,
      debtorName: (await deps.profiles.get(request.fromUserId))?.name ?? `id${request.fromUserId}`,
    });
  }

  await show(ctx, dutiesPanel({ debts, credits }));
};
