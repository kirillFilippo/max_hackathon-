import { formatDateTime } from '../../domain/datetime.js';
import type { DosugEvent, ItemWithReservation } from '../../domain/types.js';
import type { ReserveOutcome } from '../../services/itemService.js';
import {
  CB,
  cbEventCard,
  cbItemRelease,
  cbItemTake,
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
  return `${number} ${item.title} — ${reservation.userName}${mine}`;
};

const stats = (items: ItemWithReservation[]): string => {
  const taken = items.filter((item) => item.reservation !== null).length;
  return `Позиций: ${items.length}, занято ${taken}, свободно ${items.length - taken}`;
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
    rows.push([cb(`Мои позиции (${mine.length})`, cbShopMine(event.code))]);
  }

  if (options.isOrganizer) {
    rows.push([cb('Добавить позиции', cbShopAdd(event.code)), cb('Разослать список', cbShopNotify(event.code))]);
  }
  rows.push([cb('К событию', cbEventCard(event.code))]);
  return withKeyboard(lines.join('\n'), rows);
};

/** Экран «мои позиции»: посмотреть, что взяли, или отказаться от позиции. */
export const myItems = (event: DosugEvent, items: ItemWithReservation[]): MessageContent => {
  const lines = [`Мои позиции: ${event.title}`, ''];
  if (items.length === 0) {
    lines.push('Вы пока ничего не забронировали. Откройте список покупок и возьмите позицию.');
    return withKeyboard(lines.join('\n'), [
      [cb('Список покупок', cbShopShow(event.code))],
    ]);
  }

  lines.push('Эти позиции закреплены за вами: остальные видят, что покупать не нужно.');
  lines.push('');
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
  });

  const rows: KeyboardRows = items.slice(0, 6).map((item) => [
    cb(`Отказаться: ${truncate(item.title, 18)}`, cbItemRelease(event.code, item.id)),
  ]);
  rows.push([cb('Список покупок', cbShopShow(event.code))]);
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
  /** Кто смотрит: нужен, чтобы отметить свои позиции «(вы)». */
  userId = 0,
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
    items.forEach((item, index) => lines.push(itemLine(item, index, userId)));
  }

  const rows: KeyboardRows = [];
  if (outcome.reserved.length > 0) {
    rows.push([cb('Мои позиции', cbShopMine(event.code))]);
  }
  const free = items.filter((item) => item.reservation === null);
  if (free.length > 0) {
    rows.push([cb(`Взять ещё (свободно ${free.length})`, cbShopShow(event.code))]);
  }
  rows.push([cb('К событию', cbEventCard(event.code))]);
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
  ];
  return withKeyboard(lines.join('\n'), [[cb('Список покупок', cbShopShow(event.code))]]);
};
