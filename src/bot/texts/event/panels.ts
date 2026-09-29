import { formatDateTime, formatDateTimeShort } from '../../../domain/datetime/index.js';
import type { DosugEvent, Participant } from '../../../domain/types.js';
import { CB, cbEventCard, cbEventPeople, cbEventRemind } from '../../callbacks.js';
import { cb, chunk, truncate, withKeyboard, type KeyboardRows, type MessageContent } from '../../message.js';
import { isGoing } from '../../../domain/stats.js';
import { type ViewOptions, MAX_LISTED } from './common.js';

export const eventList = (events: DosugEvent[], options: ViewOptions): MessageContent => {
  if (events.length === 0) {
    return withKeyboard('Событий пока нет. Создайте первое — это занимает около минуты.', [
      [cb('Создать событие', CB.eventNew)],
    ]);
  }
  const lines = ['Ваши события', ''];
  events.forEach((event, index) => {
    const status = event.status === 'closed' ? ' (завершено)' : '';
    lines.push(`${index + 1}. ${formatDateTimeShort(event.startsAt, options.tz)} — ${event.title}${status}`);
  });
  lines.push('', 'Нажмите на событие, чтобы открыть карточку.');

  const rows: KeyboardRows = chunk(events.slice(0, 12), 2).map((pair) =>
    pair.map((event) => cb(truncate(event.title, 20), cbEventCard(event.code))),
  );
  rows.push([cb('Создать событие', CB.eventNew)]);
  return withKeyboard(lines.join('\n'), rows);
};

export const participantsPanel = (
  event: DosugEvent,
  participants: Participant[],
  options: ViewOptions,
): MessageContent => {
  const lines = [`Участники: ${event.title}`, `Когда: ${formatDateTime(event.startsAt, options.tz)}`, ''];

  const group = (predicate: (participant: Participant) => boolean): Participant[] =>
    participants.filter(predicate);

  const renderGroup = (title: string, list: Participant[]): void => {
    lines.push(`${title} — ${list.length}`);
    if (list.length === 0) {
      lines.push('  нет');
      lines.push('');
      return;
    }
    list.slice(0, MAX_LISTED).forEach((participant, index) => {
      const contact = participant.contact ? `, ${participant.contact}` : '';
      const answers = event.fields
        .map((field) => participant.answers[field.id])
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => truncate(value, 40));
      const details = answers.length > 0 ? ` — ${answers.join('; ')}` : '';
      lines.push(`  ${index + 1}. ${participant.name}${contact}${details}`);
    });
    if (list.length > MAX_LISTED) lines.push(`  и ещё ${list.length - MAX_LISTED}`);
    lines.push('');
  };

  renderGroup('Идут', group(isGoing));
  renderGroup('Под вопросом', group((p) => p.status === 'maybe'));
  renderGroup('Не идут', group((p) => p.status === 'not_going'));
  const waitlisted = group((p) => p.waitlisted);
  if (waitlisted.length > 0) renderGroup('Лист ожидания', waitlisted);
  lines.push('Список обновляется, когда участник меняет статус.');

  const rows: KeyboardRows = [
    [cb('Обновить', cbEventPeople(event.code)), cb('Напомнить', cbEventRemind(event.code))],
    [cb('К событию', cbEventCard(event.code))],
  ];
  return withKeyboard(lines.join('\n'), rows);
};
