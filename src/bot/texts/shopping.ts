import { formatDateTime } from '../../domain/datetime.js';
import { formatRub } from '../../domain/money.js';
import type { DosugEvent, ItemWithReservation } from '../../domain/types.js';
import type { ReserveOutcome } from '../../services/itemService.js';
import {
  CB,
  cbEventCard,
  cbItemPrice,
  cbItemRelease,
  cbItemTake,
  cbMoneyShow,
  cbShopAdd,
  cbShopMine,
  cbShopNotify,
  cbShopReserve,
  cbShopShow,
} from '../callbacks.js';
import { cb, truncate, withKeyboard, type KeyboardRows, type MessageContent } from '../message.js';

export interface ShoppingOptions {
  isOrganizer: boolean;
  userId: number;
}

const itemLine = (
  item: ItemWithReservation,
  index: number,
  userId: number,
): string => {
  const number = `${index + 1}.`;
  const reservation = item.reservation;
  if (!reservation) return `${number} ${item.title} — свободно`;
  const mine = reservation.userId === userId ? ' (вы)' : '';
  const amount = reservation.paidKopecks === null ? '' : `, потрачено ${formatRub(reservation.paidKopecks)}`;
  const paid = reservation.paidKopecks === null ? '' : reservation.paidAt ? ', куплено' : '';
  return `${number} ${item.title} — ${reservation.userName}${mine}${amount}${paid}`;
};

const stats = (items: ItemWithReservation[]): string => {
  const taken = items.filter((item) => item.reservation !== null).length;
  const paidTotal = items.reduce((sum, item) => sum + (item.reservation?.paidKopecks ?? 0), 0);
  const lines = [`Позиций: ${items.length}, занято ${taken}, свободно ${items.length - taken}`];
  if (paidTotal > 0) lines.push(`Указано сумм на ${formatRub(paidTotal)}`);
  return lines.join('\n');
};

/** Общий список покупок. Номера позиций — те же, что вводит участник. */
export const shoppingList = (
  event: DosugEvent,
  items: ItemWithReservation[],
  options: ShoppingOptions,
): MessageContent => {
  const lines = [`Список покупок: ${event.title}`, ''];
  if (items.length === 0) {
    lines.push('Список пуст. Организатор может добавить позиции.');
  } else {
    items.forEach((item, index) => lines.push(itemLine(item, index, options.userId)));
    lines.push('', stats(items));
    lines.push(
      '',
      'Каждую позицию берёт один человек: кто первый забронировал, тот и покупает.',
      'Забронировать можно кнопками ниже или отправьте номера через пробел — например «1 3 5».',
    );
  }

  const rows: KeyboardRows = [];
  if (items.length > 0) {
    const free = items
      .map((item, index) => ({ item, number: index + 1 }))
      .filter(({ item }) => item.reservation === null)
      .slice(0, 6);
    for (const { item, number } of free) {
      rows.push([cb(`${number}. ${truncate(item.title, 24)} — взять`, cbItemTake(event.code, item.id))]);
    }
    rows.push([cb('Отправить номера списком', cbShopReserve(event.code))]);
  }

  const mine = items.filter((item) => item.reservation?.userId === options.userId);
  if (mine.length > 0) {
    rows.push([cb(`Мои позиции (${mine.length}): указать суммы`, cbShopMine(event.code))]);
  }

  if (options.isOrganizer) {
    rows.push([cb('Добавить позиции', cbShopAdd(event.code)), cb('Разослать список', cbShopNotify(event.code))]);
  }
  rows.push([cb('Расчёты', cbMoneyShow(event.code)), cb('К событию', cbEventCard(event.code))]);
  return withKeyboard(lines.join('\n'), rows);
};

/** Экран «мои позиции»: указать фактическую сумму или отказаться от позиции. */
export const myItems = (event: DosugEvent, items: ItemWithReservation[]): MessageContent => {
  const lines = [`Мои позиции: ${event.title}`, ''];
  if (items.length === 0) {
    lines.push('Вы пока ничего не забронировали. Откройте список покупок и возьмите позицию.');
    return withKeyboard(lines.join('\n'), [
      [cb('Список покупок', cbShopShow(event.code))],
    ]);
  }

  lines.push('После покупки укажите фактически потраченную сумму — по ней бот считает общие траты.');
  lines.push('');
  items.forEach((item, index) => {
    const amount = item.reservation?.paidKopecks;
    lines.push(
      `${index + 1}. ${item.title} — ${amount == null ? 'сумма не указана' : `потрачено ${formatRub(amount)}`}`,
    );
  });

  const rows: KeyboardRows = items.slice(0, 6).map((item) => {
    const paid = item.reservation?.paidKopecks;
    return [
      cb(
        paid == null
          ? `Указать сумму: ${truncate(item.title, 18)}`
          : `Изменить сумму: ${truncate(item.title, 18)}`,
        cbItemPrice(event.code, item.id),
      ),
      cb(`Отказаться`, cbItemRelease(event.code, item.id)),
    ];
  });
  rows.push([cb('Список покупок', cbShopShow(event.code)), cb('Расчёты', cbMoneyShow(event.code))]);
  return withKeyboard(lines.join('\n'), rows);
};

export const addItemsPrompt = (event: DosugEvent): MessageContent =>
  withKeyboard(
    [
      `Новые позиции для «${event.title}»`,
      '',
      'Отправьте список: одна позиция — одна строка.',
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

export const reserveNumbersPrompt = (event: DosugEvent, items: ItemWithReservation[]): MessageContent =>
  withKeyboard(
    [
      `Бронирование позиций для «${event.title}»`,
      '',
      'Отправьте номера позиций через пробел.',
      'Если позицию уже кто-то взял, бот скажет кому она досталась и что осталось.',
      '',
      items.map((item, index) => itemLine(item, index, 0)).join('\n'),
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

export const itemPricePrompt = (item: ItemWithReservation): MessageContent =>
  withKeyboard(
    [
      `Сколько вы заплатили за «${item.title}»?`,
      '',
      'Напишите сумму в рублях.',
      'Если покупка не состоялась, отправьте 0 — позиция освободится.',
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

/** Результат бронирования: что удалось взять, что занято и что осталось. */
export const reserveResult = (
  event: DosugEvent,
  outcome: ReserveOutcome,
  items: ItemWithReservation[],
): MessageContent => {
  const lines: string[] = [`Список покупок: ${event.title}`, ''];

  if (outcome.reserved.length > 0) {
    lines.push('Забронировано за вами:');
    outcome.reserved.forEach((item) => lines.push(`  ${item.title}`));
    lines.push('');
  }
  if (outcome.alreadyMine.length > 0) {
    lines.push(`Уже были за вами: ${outcome.alreadyMine.map((item) => item.title).join(', ')}`);
    lines.push('');
  }
  if (outcome.taken.length > 0) {
    lines.push('Эти позиции уже заняты:');
    outcome.taken.forEach(({ item, byName }) => lines.push(`  ${item.title} — ${byName}`));
    lines.push('');
  }
  if (outcome.unknown.length > 0) {
    lines.push(`Номеров нет в списке: ${outcome.unknown.join(', ')}`);
    lines.push('');
  }

  if (items.length === 0) {
    lines.push('В списке пока нет позиций.');
  } else {
    lines.push('Текущий список:');
    items.forEach((item, index) => lines.push(itemLine(item, index, 0)));
  }

  const rows: KeyboardRows = [];
  if (outcome.reserved.length > 0) {
    rows.push([cb('Указать суммы по моим позициям', cbShopMine(event.code))]);
  }
  const free = items.filter((item) => item.reservation === null);
  if (free.length > 0) {
    rows.push([cb(`Взять ещё (свободно ${free.length})`, cbShopShow(event.code))]);
  }
  rows.push([cb('Расчёты', cbMoneyShow(event.code)), cb('К событию', cbEventCard(event.code))]);
  return withKeyboard(lines.join('\n'), rows);
};

/** Рассылка участникам, когда организатор объявил список. */
export const listReadyNotification = (
  event: DosugEvent,
  items: ItemWithReservation[],
  tz: string,
): MessageContent => {
  const free = items.filter((item) => item.reservation === null);
  const lines = [
    `Список покупок по событию «${event.title}»`,
    `Когда: ${formatDateTime(event.startsAt, tz)}`,
    '',
    free.length === 0
      ? 'Все позиции уже разобрали.'
      : `Свободно ${free.length} из ${items.length}: ${free.map((item) => item.title).join(', ')}.`,
    '',
    'Откройте список и возьмите позицию, чтобы не дублировать покупки.',
    'После покупки укажите потраченную сумму — бот посчитает, кто кому переводит.',
  ];
  return withKeyboard(lines.join('\n'), [[cb('Список покупок', cbShopShow(event.code))]]);
};
