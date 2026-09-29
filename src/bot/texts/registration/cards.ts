import { formatDateTime } from '../../../domain/datetime/index.js';
import type { DosugEvent } from '../../../domain/types.js';
import { cbEventPeople, cbRegStatus } from '../../callbacks.js';
import { cb, link, withKeyboard, type KeyboardRows, type MessageContent } from '../../message.js';

/** Карточки заявки: анкета в приложении и уведомление организатору. */

/**
 * Анкета тяжёлая (вес вопросов выше порога): участник заполняет её в мини-приложении,
 * потому что в чате это превратилось бы в десяток сообщений.
 */
export const answerFormCard = (
  event: DosugEvent,
  answersUrl: string | undefined,
  options: { tz: string },
): MessageContent => {
  const lines = [
    'Анкета участника',
    '',
    `Событие: ${event.title}`,
    `Когда: ${formatDateTime(event.startsAt, options.tz)}`,
    `Место: ${event.place}`,
    '',
    `Вопросов: ${event.fields.length}. Удобнее заполнить их в приложении — все вопросы на одном экране.`,
  ];
  const rows: KeyboardRows = [];
  if (answersUrl) rows.push([link('Заполнить анкету', answersUrl)]);
  rows.push([cb('Не смогу прийти', cbRegStatus(event.code, 'not_going'))]);
  return withKeyboard(lines.join('\n'), rows);
};

/** Уведомление организатору о новой заявке — общее для чата и мини-приложения. */
export const registrationNotice = (
  event: DosugEvent,
  data: {
    name: string;
    contact: string;
    statusLabel: string;
    waitlisted: boolean;
    answers: Record<string, string>;
  },
): MessageContent => {
  const answers = event.fields
    .map((field) => `${field.label}: ${data.answers[field.id] ?? '—'}`)
    .join('\n');
  return withKeyboard(
    [
      `Новая заявка: ${data.name} — ${data.statusLabel}`,
      `Событие: ${event.title} (${event.code})`,
      data.contact ? `Контакт: ${data.contact}` : '',
      answers ? `\n${answers}` : '',
      data.waitlisted ? '\nУчастник в листе ожидания: мест нет.' : '',
    ]
      .filter((line) => line !== '')
      .join('\n'),
    [[cb('Участники', cbEventPeople(event.code))]],
  );
};
