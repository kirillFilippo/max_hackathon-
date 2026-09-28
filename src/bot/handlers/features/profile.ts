import { formatDateTime } from '../../../domain/datetime.js';
import { STATUS_LABELS } from '../../../domain/types.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { contactPrompt, profileCard } from '../../texts/profile.js';
import { requireUser, userIdOf } from '../helpers.js';

export const showProfile = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const user = requireUser(ctx);
  const profile = await deps.profiles.touchFromMax(user);
  const participations = await deps.repos.participants.listByUser(user.user_id);

  const lines = [];
  for (const participation of participations.slice(0, 5)) {
    const event = await deps.events.findById(participation.eventId);
    if (!event) continue;
    lines.push({
      title: `${event.title} (${formatDateTime(event.startsAt, deps.config.appTz)})`,
      startsAt: event.startsAt,
      status: STATUS_LABELS[participation.status],
    });
  }

  await show(ctx, profileCard(profile, lines));
};

export const startContactDraft = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  if (!ctx.session) return;
  const profile = await deps.profiles.get(userIdOf(ctx));
  ctx.session.draft = { kind: 'profile-contact', step: 'contact' };
  await show(ctx, contactPrompt(profile));
};

