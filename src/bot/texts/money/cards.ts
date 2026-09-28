import { formatDateTime } from '../../../domain/datetime.js';
import { formatRub } from '../../../domain/money.js';
import type { DosugEvent, TransferRequest, UserProfile } from '../../../domain/types.js';
import type { SettlementView } from '../../../services/settlementService.js';
import {
  CB,
  cbEventCard,
  cbMoneyShow,
  cbTransferDetails,
  cbTransferPaid,
  cbTransferPerson,
  cbTransferReceived,
} from '../../callbacks.js';
import {
  cb,
  truncate,
  withKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../message.js';
import { transferStatusLabel } from './panel.js';


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
