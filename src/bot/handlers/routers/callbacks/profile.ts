import type { ParticipantStatus } from '../../../../domain/types.js';
import { type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { startContactDraft } from '../../features/profile.js';


export const handleProfile = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
if (args[0] === 'contact') {
  await startContactDraft(ctx, deps);
  return;
}
return;
};
