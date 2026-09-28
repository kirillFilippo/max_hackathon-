import type { ParticipantStatus } from '../../../../domain/types.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { helpText } from '../../../texts/common.js';
import { showFaq } from '../../features/faq.js';
import { showEventList, showMainMenu } from '../../features/events.js';
import { showDuties } from '../../features/money.js';
import { showProfile } from '../../features/profile.js';
import { showTemplates } from '../../features/templates.js';


export const handleMenu = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
switch (args[0]) {
  case 'events':
    await showEventList(ctx, deps);
    return;
  case 'templates':
    await showTemplates(ctx, deps);
    return;
  case 'faq':
    await showFaq(ctx, deps);
    return;
  case 'help':
    await show(ctx, helpText());
    return;
  case 'profile':
    await showProfile(ctx, deps);
    return;
  case 'duties':
    await showDuties(ctx, deps);
    return;
  default:
    await showMainMenu(ctx, deps);
}
return;
};
