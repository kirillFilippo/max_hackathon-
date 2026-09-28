import { show, userText, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { contactPrompt, contactSaved } from '../../texts/profile.js';
import type { DraftState } from '../../session.js';
import { userIdOf } from '../helpers.js';

export type ProfileContactDraft = Extract<DraftState, { kind: 'profile-contact' }>;

/** Контакт для связи: телефон, почта или ник — его видят организаторы событий. */
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
