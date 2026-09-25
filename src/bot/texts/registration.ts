import { formatDateTime } from '../../domain/datetime.js';
import type { DosugEvent, EventField, EventStats, ItemWithReservation } from '../../domain/types.js';
import { STATUS_LABELS } from '../../domain/types.js';
import { CB, cbRegAnswer, cbRegConfirm, cbRegStart, cbRegStatus, cbRegToggle } from '../callbacks.js';
import { escapeMarkdown, link, mapLink, withMarkdownKeyboard } from '../message.js';
import { describeConstraints } from '../../domain/validation.js';
import { button, cb, chunk, text, valueOrDash, withKeyboard, type KeyboardRows, type MessageContent } from '../message.js';
import type { RegisterDraftData } from '../session.js';

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
  rows.push([cb('Не смогу прийти', `reg:status:${event.code}:not_going`)]);
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
    [[cb('Участники', `ev:people:${event.code}`)]],
  );
};

export const namePrompt = (event: DosugEvent, suggested: string): MessageContent =>
  withKeyboard(
    [
      `Заявка на «${event.title}»`,
      '',
      'Как вас записать? Организатор увидит это имя в списке участников.',
    ].join('\n'),
    [
      [cb(`Оставить «${suggested}»`, CB.regNameSelf)],
      [cb('Отмена', CB.regCancel)],
    ],
  );

export const contactPrompt = (event: DosugEvent): MessageContent =>
  withKeyboard(
    [
      `Заявка на «${event.title}»`,
      '',
      'Контакт для связи, если что-то изменится.',
      'Можно отправить телефон кнопкой или написать вручную — телефон, ник в MAX.',
    ].join('\n'),
    [
      [button.requestContact('Отправить мой телефон')],
      [cb('Пропустить', CB.regContactSkip), cb('Отмена', CB.regCancel)],
    ],
  );

export const statusPrompt = (event: DosugEvent): MessageContent =>
  withKeyboard('Вы придёте?', [
    [
      cb('Иду', cbRegStatus(event.code, 'going')),
      cb('Под вопросом', cbRegStatus(event.code, 'maybe')),
      cb('Не смогу', cbRegStatus(event.code, 'not_going')),
    ],
    [cb('Отмена', CB.regCancel)],
  ]);

const fieldHint = (field: EventField): string => {
  switch (field.type) {
    case 'number':
      return 'Отправьте число сообщением.';
    case 'date':
      return 'Отправьте дату в формате ДД.ММ.ГГГГ, например 25.10.2026.';
    case 'text':
      return `Отправьте ответ сообщением${field.maxLength === null ? '' : `, до ${field.maxLength} символов`}.`;
    case 'choice':
      return field.multiple
        ? 'Отметьте нужные варианты кнопками и нажмите «Готово».'
        : 'Выберите один вариант.';
    default:
      return '';
  }
};

export const registerFieldPrompt = (
  field: EventField,
  index: number,
  total: number,
  selected: string[] = [],
): MessageContent => {
  const lines = [
    `Вопрос ${index + 1} из ${total}`,
    field.label,
    `(${describeConstraints(field)})`,
  ];
  const hint = fieldHint(field);
  if (hint) lines.push('', hint);

  if (field.type === 'choice' && field.multiple) {
    const rows: KeyboardRows = chunk(
      field.options.map((option, optionIndex) => ({ option, optionIndex })),
      2,
    ).map((pair) =>
      pair.map(({ option, optionIndex }) => {
        const mark = selected.includes(option) ? '• ' : '';
        return cb(`${mark}${option}`, cbRegToggle(index, optionIndex));
      }),
    );
    rows.push([cb('Готово', cbRegAnswer(index, 'done'))]);
    if (!field.required) rows.push([cb('Пропустить', cbRegAnswer(index, 'skip'))]);
    return withKeyboard(lines.join('\n'), rows);
  }

  if (field.type === 'choice') {
    const rows: KeyboardRows = chunk(
      field.options.map((option, optionIndex) => ({ option, optionIndex })),
      2,
    ).map((pair) =>
      pair.map(({ option, optionIndex }) => cb(option, cbRegAnswer(index, String(optionIndex)))),
    );
    if (!field.required) rows.push([cb('Пропустить', cbRegAnswer(index, 'skip'))]);
    return withKeyboard(lines.join('\n'), rows);
  }

  if (field.type === 'yesno') {
    const rows: KeyboardRows = [
      [cb('Да', cbRegAnswer(index, 'yes')), cb('Нет', cbRegAnswer(index, 'no'))],
    ];
    if (!field.required) rows.push([cb('Пропустить', cbRegAnswer(index, 'skip'))]);
    return withKeyboard(lines.join('\n'), rows);
  }

  return text(lines.join('\n'));
};

export const registerSummary = (
  event: DosugEvent,
  data: RegisterDraftData,
  options: { tz: string },
): MessageContent => {
  const lines = [
    'Проверьте заявку',
    '',
    `Событие: ${event.title}`,
    `Когда: ${formatDateTime(event.startsAt, options.tz)}`,
    `Имя: ${valueOrDash(data.participantName)}`,
    `Контакт: ${valueOrDash(data.contact)}`,
    `Статус: ${data.status ? STATUS_LABELS[data.status] : '—'}`,
  ];
  if (event.fields.length > 0) {
    lines.push('', 'Ответы:');
    for (const field of event.fields) {
      lines.push(`${field.label}: ${valueOrDash(data.answers[field.id])}`);
    }
  }
  lines.push('', `Адрес: ${mapLink(event.place, event.placeCoords)}`);

  return withMarkdownKeyboard(lines.join('\n'), [
    [cb('Всё верно, отправить', cbRegConfirm(event.code))],
    [cb('Заполнить заново', cbRegStart(event.code)), cb('Отмена', CB.regCancel)],
  ]);
};

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
    [
      [
        cb('Иду', cbRegStatus(event.code, 'going')),
        cb('Под вопросом', cbRegStatus(event.code, 'maybe')),
        cb('Не смогу', cbRegStatus(event.code, 'not_going')),
      ],
    ],
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
    [cb('Иду', cbRegStatus(event.code, 'going')), cb('Не смогу', cbRegStatus(event.code, 'not_going'))],
    [cb('Список покупок', `shop:show:${event.code}`)],
  ]);
};
