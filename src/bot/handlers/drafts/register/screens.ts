import { type DosugEvent } from '../../../../domain/types.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import type { DraftState, RegisterStep } from '../../../session.js';
import { registerFieldPrompt, registerSummary } from '../../../texts/registration.js';


export type RegisterDraft = Extract<DraftState, { kind: 'register' }>;

export const renderConfirm = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  data: RegisterDraft['data'],
): Promise<void> => {
  await show(ctx, registerSummary(event, data, { tz: deps.config.appTz }));
};

export const renderField = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  draft: RegisterDraft,
): Promise<void> => {
  const field = event.fields[draft.data.fieldIndex];
  if (!field) {
    draft.step = 'confirm';
    await renderConfirm(ctx, deps, event, draft.data);
    return;
  }
  const selected = (draft.data.answers[field.id] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  await show(ctx, registerFieldPrompt(field, draft.data.fieldIndex, event.fields.length, selected));
};

export const goToFieldsOrConfirm = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  draft: RegisterDraft,
): Promise<void> => {
  if (draft.data.status === 'not_going' || event.fields.length === 0) {
    draft.step = 'confirm';
    await renderConfirm(ctx, deps, event, draft.data);
    return;
  }
  draft.step = 'fields';
  draft.data.fieldIndex = 0;
  await renderField(ctx, deps, event, draft);
};
