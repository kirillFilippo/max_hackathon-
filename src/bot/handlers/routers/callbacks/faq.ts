import type { ParticipantStatus } from '../../../../domain/types.js';
import { type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { showFaq, answerFaqKey } from '../../features/faq.js';


export const handleFaq = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
if (args[0] === 'q' && args[1]) {
  await answerFaqKey(ctx, deps, args[1]);
  return;
}
if (args[0] === 'ev' && args[1] && args[2]) {
  await answerFaqKey(ctx, deps, args[2], args[1]);
  return;
}
await showFaq(ctx, deps);
return;
};
