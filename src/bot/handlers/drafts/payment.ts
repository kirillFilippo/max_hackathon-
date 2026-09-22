import { CB } from '../../callbacks.js';
import { show, userText, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import type { DraftState } from '../../session.js';
import { paymentHandlePrompt } from '../../texts/money.js';
import { bankPrompt as profileBankPrompt, contactPrompt, contactSaved, handlePrompt as profileHandlePrompt, paymentSaved } from '../../texts/profile.js';
import { menuRow, userIdOf } from '../helpers.js';
import { applyTransferDetails } from '../features/money.js';

export type PaymentDetailsDraft = Extract<DraftState, { kind: 'payment-details' }>;
export type ProfileContactDraft = Extract<DraftState, { kind: 'profile-contact' }>;
export type ProfilePaymentDraft = Extract<DraftState, { kind: 'profile-payment' }>;

/** Диалог реквизитов для конкретного расчёта: банк → номер → передать получателю. */
export const handlePaymentDetailsDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: PaymentDetailsDraft,
): Promise<boolean> => {
  const input = userText(ctx);
  const request = await deps.settlements.find(draft.requestId);
  if (!request) {
    if (ctx.session) ctx.session.draft = null;
    await show(ctx, withKeyboard('Запрос на расчёт не найден.', menuRow));
    return true;
  }

  if (draft.step === 'bank') {
    if (!input) {
      await show(ctx, withKeyboard('Напишите название банка, например «Тинькофф».', [[cb('Отмена', CB.draftCancel)]]));
      return true;
    }
    draft.bankName = input.slice(0, 60);
    draft.step = 'handle';
    await show(ctx, paymentHandlePrompt(draft.bankName));
    return true;
  }

  if (!input) {
    await show(ctx, paymentHandlePrompt(draft.bankName ?? 'банк'));
    return true;
  }

  if (ctx.session) ctx.session.draft = null;
  await applyTransferDetails(ctx, deps, draft.requestId, draft.bankName ?? '', input);
  return true;
};

/** Контакт в профиле пользователя. */
export const handleProfileContactDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  _draft: ProfileContactDraft,
): Promise<boolean> => {
  const input = userText(ctx);
  if (!input) {
    const profile = await deps.profiles.get(userIdOf(ctx));
    await show(ctx, contactPrompt(profile));
    return true;
  }
  if (ctx.session) ctx.session.draft = null;
  const profile = await deps.profiles.saveContact(userIdOf(ctx), input);
  await show(ctx, contactSaved(profile));
  return true;
};

/** Реквизиты в профиле пользователя: банк → номер. */
export const handleProfilePaymentDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: ProfilePaymentDraft,
): Promise<boolean> => {
  const input = userText(ctx);

  if (draft.step === 'bank') {
    if (!input) {
      const profile = await deps.profiles.get(userIdOf(ctx));
      await show(ctx, profileBankPrompt(profile));
      return true;
    }
    draft.bankName = input.slice(0, 60);
    draft.step = 'handle';
    await show(ctx, profileHandlePrompt(draft.bankName));
    return true;
  }

  if (!input) {
    await show(ctx, profileHandlePrompt(draft.bankName ?? 'банк'));
    return true;
  }

  if (ctx.session) ctx.session.draft = null;
  const profile = await deps.profiles.savePaymentDetails(userIdOf(ctx), draft.bankName ?? '', input);
  await show(ctx, paymentSaved(profile));
  return true;
};
