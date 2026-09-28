import type { ParticipantStatus } from '../../../../domain/types.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import {
  markTransferInPerson,
  markTransferPaid,
  markTransferReceived,
  requestTransfers,
  showSettlement,
  startTransferDetails,
} from '../../features/money.js';


export const handleMoney = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
const [sub, code = ''] = args;
if (sub === 'show') {
  await showSettlement(ctx, deps, code);
  return;
}
if (sub === 'request') {
  await requestTransfers(ctx, deps, code);
}
return;
};

export const handleTransfer = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
const [sub, requestId = ''] = args;
switch (sub) {
  case 'details':
    await startTransferDetails(ctx, deps, requestId);
    return;
  case 'person':
    await markTransferInPerson(ctx, deps, requestId);
    return;
  case 'paid':
    await markTransferPaid(ctx, deps, requestId);
    return;
  case 'received':
    await markTransferReceived(ctx, deps, requestId);
    return;
  default:
    return;
}
};
