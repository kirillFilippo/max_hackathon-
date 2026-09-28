import { formatRub } from '../../../domain/money.js';
import type { DosugEvent, TransferRequest, UserProfile } from '../../../domain/types.js';
import type { SettlementView } from '../../../services/settlementService.js';
import { CB, cbTransferDetails } from '../../callbacks.js';
import {
  cb,
  truncate,
  withKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../message.js';
import { transferStatusLabel } from './panel.js';


export const dutiesPanel = (params: {
  debts: Array<{ request: TransferRequest; event: DosugEvent; creditorName: string }>;
  credits: Array<{ request: TransferRequest; event: DosugEvent; debtorName: string }>;
}): MessageContent => {
  const lines = ['Мои расчёты', ''];

  if (params.debts.length === 0 && params.credits.length === 0) {
    lines.push('Незакрытых расчётов нет.');
    return withKeyboard(lines.join('\n'), [[cb('В меню', CB.menuMain)]]);
  }

  if (params.debts.length > 0) {
    lines.push('Вы должны:');
    params.debts.forEach(({ request, event, creditorName }) => {
      lines.push(
        `  ${creditorName}: ${formatRub(request.amountKopecks)} — ${event.title} (${transferStatusLabel(request.status)})`,
      );
    });
    lines.push('');
  }
  if (params.credits.length > 0) {
    lines.push('Должны вам:');
    params.credits.forEach(({ request, event, debtorName }) => {
      lines.push(
        `  ${debtorName}: ${formatRub(request.amountKopecks)} — ${event.title} (${transferStatusLabel(request.status)})`,
      );
    });
    lines.push('');
  }

  const rows: KeyboardRows = params.debts
    .slice(0, 5)
    .map(({ request, creditorName }) => [
      cb(`Рассчитаться с ${truncate(creditorName, 18)}`, cbTransferDetails(request.id)),
    ]);
  rows.push([cb('В меню', CB.menuMain)]);
  return withKeyboard(lines.join('\n'), rows);
};
