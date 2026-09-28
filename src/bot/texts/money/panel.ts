import { formatRub } from '../../../domain/money.js';
import type { DosugEvent, TransferRequest, UserProfile } from '../../../domain/types.js';
import type { SettlementView } from '../../../services/settlementService.js';
import { cbEventCard, cbMoneyRequest, cbMoneyShow } from '../../callbacks.js';
import {
  cb,
  withKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../message.js';


const TRANSFER_STATUS_LABELS: Record<TransferRequest['status'], string> = {
  pending: 'запрос отправлен',
  details_sent: 'реквизиты отправлены',
  in_person: 'отдаст при встрече',
  paid: 'перевод сделан, ждём подтверждения',
  closed: 'закрыт',
};

export const transferStatusLabel = (status: TransferRequest['status']): string =>
  TRANSFER_STATUS_LABELS[status];

export interface SettlementPanelOptions {
  tz: string;
  isOrganizer: boolean;
  nameOf: (userId: number) => string;
}

/** Панель расчётов: сколько потрачено, доля каждого, кто кому переводит. */
export const settlementPanel = (
  view: SettlementView,
  requests: TransferRequest[],
  options: SettlementPanelOptions,
): MessageContent => {
  const { event, settlement } = view;
  const lines = [`Расчёты по событию «${event.title}»`, ''];

  if (settlement.totalKopecks === 0) {
    lines.push(
      'Считать пока нечего: ни по одной забронированной позиции не указана сумма.',
      '',
      'Участники бронируют позиции в списке покупок, покупают и указывают фактическую сумму — после этого появится расчёт.',
    );
    const rows: KeyboardRows = [
      [cb('Список покупок', `shop:show:${event.code}`), cb('К событию', cbEventCard(event.code))],
    ];
    return withKeyboard(lines.join('\n'), rows);
  }

  lines.push(
    `Общие траты: ${formatRub(settlement.totalKopecks)}`,
    `Участников: ${settlement.participantsCount}, доля каждого ${formatRub(settlement.perPersonKopecks)}`,
    '',
    'Кто сколько внёс:',
  );
  settlement.paid
    .filter((entry) => entry.amountKopecks > 0)
    .forEach((entry) => lines.push(`  ${entry.name}: ${formatRub(entry.amountKopecks)}`));
  if (!settlement.paid.some((entry) => entry.amountKopecks > 0)) lines.push('  пока никто');

  lines.push('', 'Кто кому переводит:');
  if (settlement.transfers.length === 0) {
    lines.push('  переводы не нужны, все в равном расчёте');
  } else {
    settlement.transfers.forEach((transfer) => {
      lines.push(`  ${transfer.fromName} → ${transfer.toName}: ${formatRub(transfer.amountKopecks)}`);
    });
  }

  if (requests.length > 0) {
    lines.push('', 'Статусы расчётов:');
    requests.forEach((request) => {
      lines.push(
        `  ${options.nameOf(request.fromUserId)} → ${options.nameOf(request.toUserId)}: `
          + `${formatRub(request.amountKopecks)}, ${transferStatusLabel(request.status)}`,
      );
    });
  }

  if (settlement.itemsWithoutAmount.length > 0) {
    lines.push(
      '',
      `Без указанной суммы: ${settlement.itemsWithoutAmount.map((item) => item.title).join(', ')}. `
        + 'Эти позиции в расчёт не входят.',
    );
  }
  if (settlement.unreservedItems.length > 0) {
    lines.push('', `Никто не взял: ${settlement.unreservedItems.map((item) => item.title).join(', ')}.`);
  }
  if (settlement.roundingRemainderKopecks !== 0) {
    lines.push('', `Остаток округления ${formatRub(settlement.roundingRemainderKopecks)} — можно не учитывать.`);
  }

  lines.push('', 'Переводы участники делают друг другу сами, бот только считает и передаёт реквизиты.');

  const rows: KeyboardRows = [];
  if (options.isOrganizer && settlement.transfers.length > 0) {
    rows.push([cb('Создать запросы на перевод', cbMoneyRequest(event.code))]);
  }
  rows.push([cb('Обновить', cbMoneyShow(event.code)), cb('Список покупок', `shop:show:${event.code}`)]);
  rows.push([cb('К событию', cbEventCard(event.code))]);
  return withKeyboard(lines.join('\n'), rows);
};

/** Карточка должника: кому, сколько и как рассчитаться. */
