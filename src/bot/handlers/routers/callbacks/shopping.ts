import type { BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import {
  notifyShoppingList,
  releaseItem,
  showMyItems,
  showShoppingList,
  takeItem,
} from '../../features/shopping.js';
import { startAddItems, startReserveNumbers } from '../../drafts/items.js';


export const handleShopping = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
const [sub, code = ''] = args;
switch (sub) {
  case 'show':
    await showShoppingList(ctx, deps, code);
    return;
  case 'mine':
    await showMyItems(ctx, deps, code);
    return;
  case 'add':
    await startAddItems(ctx, deps, code);
    return;
  case 'reserve':
    await startReserveNumbers(ctx, deps, code);
    return;
  case 'notify':
    await notifyShoppingList(ctx, deps, code);
    return;
  default:
    return;
}
};

export const handleItem = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
const [sub, code = '', itemId = ''] = args;
if (sub === 'take') {
  await takeItem(ctx, deps, code, itemId);
  return;
}
if (sub === 'release') {
  await releaseItem(ctx, deps, code, itemId);
  return;
}
return;
};
