import type { ParticipantStatus } from '../../../../domain/types.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { withKeyboard } from '../../../message.js';
import {
  beginRegistration,
  confirmRegistrationButton,
  quickStatusChange,
  startEditRegistration,
} from '../../drafts/register/index.js';
import { menuRow } from '../../helpers.js';


export const handleRegistration = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
const [sub, code = '', status = ''] = args;
// «Записаться» из приглашения (begin) и старая кнопка start ведут в мастер.
if (sub === 'begin' || sub === 'start') {
  await beginRegistration(ctx, deps, code);
  return;
}
if (sub === 'change') {
  await startEditRegistration(ctx, deps, code);
  return;
}
if (sub === 'status') {
  await quickStatusChange(ctx, deps, code, status as ParticipantStatus);
  return;
}
// Кнопки без активного черновика (сессия истекла, сообщение осталось):
// отвечаем по делу, а не молчим.
if (sub === 'confirm') {
  await confirmRegistrationButton(ctx, deps, code);
  return;
}
if (sub === 'cancel') {
  await show(ctx, withKeyboard('Заявка отменена. Вернуться можно по ссылке или командой /join.', menuRow));
}
return;
};
