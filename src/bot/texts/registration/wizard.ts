import { formatDateTime } from '../../../domain/datetime/index.js';
import type { DosugEvent, EventField } from '../../../domain/types.js';
import { STATUS_LABELS } from '../../../domain/types.js';
import { describeConstraints } from '../../../domain/validation.js';
import {
  CB,
  cbRegAnswer,
  cbRegConfirm,
  cbRegStart,
  cbRegStatus,
  cbRegToggle,
} from '../../callbacks.js';
import {
  button,
  cb,
  chunk,
  mapLink,
  text,
  valueOrDash,
  withKeyboard,
  withMarkdownKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../message.js';
import type { RegisterDraftData } from '../../session.js';

/** Шаги мастера заявки: имя, контакт, статус, вопросы, проверка. */

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

/** Одна формулировка отмены заявки: показывается на любом шаге мастера. */
export const cancelNotice = (): string =>
  'Заявка отменена. Вернуться можно по ссылке-приглашению или командой /join.';

/**
 * Ряд кнопок статуса участия. Подписи и порядок одинаковы во всех экранах
 * (приглашение, напоминание, карточка участника), поэтому собираются здесь.
 */
export const statusRow = (
  code: string,
  options: { compact?: boolean } = {},
): KeyboardRows =>
  options.compact
    ? [[cb('Иду', cbRegStatus(code, 'going')), cb('Не смогу', cbRegStatus(code, 'not_going'))]]
    : [[
      cb('Иду', cbRegStatus(code, 'going')),
      cb('Под вопросом', cbRegStatus(code, 'maybe')),
      cb('Не смогу', cbRegStatus(code, 'not_going')),
    ]];

export const statusPrompt = (event: DosugEvent): MessageContent =>
  withKeyboard('Вы придёте?', [
    ...statusRow(event.code),
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
