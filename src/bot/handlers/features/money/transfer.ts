import { formatRub } from '../../../../domain/money.js';
import type { DosugEvent, TransferRequest } from '../../../../domain/types.js';
import { cbEventCard, cbMoneyShow } from '../../../callbacks.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cb, withKeyboard } from '../../../message.js';
import {
  detailsForwarded,
  inPersonForwarded,
  paidForwarded,
  paymentBankPrompt,
  receivedNotice,
} from '../../../texts/money.js';
import { menuRow, sendToUser, userIdOf } from '../../helpers.js';

import { showDebtorCard } from './duties.js';

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
