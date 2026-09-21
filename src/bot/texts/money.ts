import { formatDateTime } from '../../domain/datetime.js';
import { formatRub } from '../../domain/money.js';
import type { DosugEvent, TransferRequest, UserProfile } from '../../domain/types.js';
import type { SettlementView } from '../../services/settlementService.js';
import {
  CB,
  cbEventCard,
  cbMoneyRequest,
  cbMoneyShow,
  cbTransferDetails,
  cbTransferPaid,
  cbTransferPerson,
  cbTransferReceived,
} from '../callbacks.js';
import { cb, truncate, withKeyboard, type KeyboardRows, type MessageContent } from '../message.js';

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
export const transferDebtorCard = (params: {
  request: TransferRequest;
  event: DosugEvent;
  creditorName: string;
  items: string[];
  profile: UserProfile | null;
  tz: string;
}): MessageContent => {
  const { request, event, creditorName, items, profile, tz } = params;
  const lines = [
    `Расчёт по событию «${event.title}»`,
    `Когда: ${formatDateTime(event.startsAt, tz)}`,
    '',
    `Вы должны: ${formatRub(request.amountKopecks)}`,
    `Кому: ${creditorName}`,
  ];
  if (items.length > 0) lines.push('За что: ' + items.map((title) => truncate(title, 40)).join(', '));
  lines.push('', 'Как удобнее рассчитаться?');

  const rows: KeyboardRows = [];
  const hasSaved = Boolean(profile && profile.bankName.trim() && profile.paymentHandle.trim());
  if (hasSaved) {
    rows.push([cb(`Отправить реквизиты (${profile!.bankName})`, cbTransferDetails(request.id))]);
  } else {
    rows.push([cb('Перевести и отправить реквизиты', cbTransferDetails(request.id))]);
  }
  rows.push([cb('Отдам при встрече', cbTransferPerson(request.id))]);
  rows.push([cb('Уже перевёл', cbTransferPaid(request.id))]);
  return withKeyboard(lines.join('\n'), rows);
};

/** Карточка получателя: кто, сколько и что известно про перевод. */
export const transferCreditorCard = (params: {
  request: TransferRequest;
  event: DosugEvent;
  debtorName: string;
  debtorProfile: UserProfile | null;
}): MessageContent => {
  const { request, event, debtorName, debtorProfile } = params;
  const lines = [
    `Расчёт по событию «${event.title}»`,
    '',
    `${debtorName} должен вам ${formatRub(request.amountKopecks)}`,
    `Статус: ${transferStatusLabel(request.status)}`,
  ];

  if (request.status === 'details_sent' && debtorProfile) {
    lines.push('', `Банк: ${debtorProfile.bankName}`, `Реквизиты: ${debtorProfile.paymentHandle}`);
  }
  if (request.status === 'in_person') {
    lines.push('', 'Договорились отдать при встрече.');
  }
  if (request.status === 'paid') {
    lines.push('', 'Участник отметил перевод. Подтвердите получение, когда деньги придут.');
  }

  const rows: KeyboardRows = [];
  if (request.status === 'paid') {
    rows.push([cb('Деньги получены', cbTransferReceived(request.id))]);
  }
  rows.push([cb('Расчёты', cbMoneyShow(event.code))]);
  return withKeyboard(lines.join('\n'), rows);
};

export const paymentBankPrompt = (amountKopecks: number): MessageContent =>
  withKeyboard(
    [
      `Реквизиты для перевода ${formatRub(amountKopecks)}`,
      '',
      'Напишите название банка: например «Тинькофф» или «Сбер».',
      'Сохраним в профиле, чтобы не спрашивать каждый раз.',
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

export const paymentHandlePrompt = (bankName: string): MessageContent =>
  withKeyboard(
    [
      `Банк: ${bankName}`,
      '',
      'Теперь номер телефона, счёт или ник для перевода.',
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

/** Сообщение получателю, когда должник прислал реквизиты. */
export const detailsForwarded = (params: {
  event: DosugEvent;
  debtorName: string;
  amountKopecks: number;
  bankName: string;
  handle: string;
  requestId: string;
}): MessageContent =>
  withKeyboard(
    [
      `Реквизиты для расчёта по «${params.event.title}»`,
      '',
      `${params.debtorName} должен вам ${formatRub(params.amountKopecks)}`,
      `Банк: ${params.bankName}`,
      `Реквизиты: ${params.handle}`,
      '',
      'Подтвердите получение, когда деньги придут.',
    ].join('\n'),
    [[cb('Деньги получены', cbTransferReceived(params.requestId))]],
  );

export const inPersonForwarded = (params: {
  event: DosugEvent;
  debtorName: string;
  amountKopecks: number;
  requestId: string;
}): MessageContent =>
  withKeyboard(
    [
      `Расчёт по «${params.event.title}»`,
      '',
      `${params.debtorName} вернёт ${formatRub(params.amountKopecks)} при встрече.`,
    ].join('\n'),
    [[cb('Деньги получены', cbTransferReceived(params.requestId))]],
  );

export const paidForwarded = (params: {
  event: DosugEvent;
  debtorName: string;
  amountKopecks: number;
  requestId: string;
}): MessageContent =>
  withKeyboard(
    [
      `Расчёт по «${params.event.title}»`,
      '',
      `${params.debtorName} отметил перевод ${formatRub(params.amountKopecks)}.`,
      'Подтвердите получение, когда деньги придут.',
    ].join('\n'),
    [[cb('Деньги получены', cbTransferReceived(params.requestId))]],
  );

export const receivedNotice = (params: {
  event: DosugEvent;
  creditorName: string;
  amountKopecks: number;
}): MessageContent =>
  withKeyboard(
    [
      `Расчёт по «${params.event.title}» закрыт`,
      '',
      `${params.creditorName} подтвердил получение ${formatRub(params.amountKopecks)}.`,
    ].join('\n'),
    [[cb('К событию', cbEventCard(params.event.code))]],
  );

/** Раздел «Мои расчёты»: что должен пользователь и что должны ему. */
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
