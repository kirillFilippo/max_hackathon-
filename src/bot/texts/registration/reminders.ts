import { formatDateTime } from '../../../domain/datetime/index.js';
import type { DosugEvent, EventStats, ItemWithReservation } from '../../../domain/types.js';
import { cbShopShow } from '../../callbacks.js';
import { cb, escapeMarkdown, mapLink, withKeyboard, withMarkdownKeyboard, type MessageContent } from '../../message.js';
import { statusRow } from './wizard.js';

/** Напоминания участнику: подтверждение статуса и детали встречи. */

/** Напоминание за 1–2 дня: просим подтвердить статус. */
export const confirmReminder = (event: DosugEvent, options: { tz: string }): MessageContent =>
  withKeyboard(
    [
      `Напоминание о событии «${event.title}»`,
      '',
      `Когда: ${formatDateTime(event.startsAt, options.tz)}`,
      `Место: ${event.place}`,
      '',
      'Подтвердите участие — организатору важно понимать состав.',
    ].join('\n'),
    statusRow(event.code),
  );

/** Напоминание за час: детали встречи и общий список покупок. */
export const finalReminder = (
  event: DosugEvent,
  stats: EventStats,
  items: ItemWithReservation[],
  options: { tz: string },
): MessageContent => {
  // За час до встречи адрес приходит ссылкой на карту — этого достаточно, чтобы дойти.
  const lines = [
    `Скоро встреча: ${escapeMarkdown(event.title)}`,
    '',
    `Когда: ${formatDateTime(event.startsAt, options.tz)}`,
    `Адрес: ${mapLink(event.place, event.placeCoords)}`,
    `Идут: ${stats.going}${stats.limit === null ? '' : ` из ${stats.limit}`}`,
  ];
  if (event.description.trim()) lines.push('', `Описание: ${event.description.slice(0, 400)}`);

  const free = items.filter((item) => item.reservation === null);
  if (free.length > 0) {
    lines.push('', `Свободно в списке покупок: ${free.map((item) => item.title).join(', ')}`);
  }

  return withMarkdownKeyboard(lines.join('\n'), [
    ...statusRow(event.code, { compact: true }),
    [cb('Список покупок', cbShopShow(event.code))],
  ]);
};
