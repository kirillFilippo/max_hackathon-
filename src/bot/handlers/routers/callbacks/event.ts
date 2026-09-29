import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import {
  closeEvent,
  remindNow,
  requireOwnEventOrCard,
  showEventCard,
  showEventDetails,
  showEventList,
  showInviteLink,
  showParticipants,
} from '../../features/events.js';
import { startCreateEvent } from '../../drafts/createEvent/index.js';
import { startEditField } from '../../drafts/editEvent.js';
import { editMenu } from '../../../texts/event/index.js';


export const handleEvent = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
const [sub, code = '', extra = ''] = args;
switch (sub) {
  case 'new':
    await startCreateEvent(ctx, deps);
    return;
  case 'list':
    await showEventList(ctx, deps);
    return;
  case 'card': {
    const event = await requireOwnEventOrCard(ctx, deps, code);
    if (event) await showEventCard(ctx, deps, code);
    return;
  }
  case 'people':
    await showParticipants(ctx, deps, code);
    return;
  case 'link':
    await showInviteLink(ctx, deps, code);
    return;
  case 'info':
    await showEventDetails(ctx, deps, code);
    return;
  case 'edit': {
    const event = await requireOwnEventOrCard(ctx, deps, code);
    if (!event) return;
    await show(ctx, editMenu(event));
    return;
  }
  case 'set': {
    const event = await requireOwnEventOrCard(ctx, deps, code);
    if (!event) return;
    await startEditField(ctx, deps, event.id, extra as 'title' | 'startsAt' | 'place' | 'description' | 'limit');
    return;
  }
  case 'remind':
    await remindNow(ctx, deps, code);
    return;
  case 'close':
    await closeEvent(ctx, deps, code);
    return;
  default:
    return;
}
};
