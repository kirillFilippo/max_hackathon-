import { formatDateTime, formatRelative } from '../../../domain/datetime.js';
import { describeField } from '../../../domain/presets.js';
import { EFFECTIVE_MODE_LABELS, resolveAnswerMode } from '../../../domain/questionnaire.js';
import type {
  AnswerMode,
  DosugEvent,
  EventField,
  EventStats,
  ItemWithReservation,
  Participant,
  PlaceCoords,
  Template,
} from '../../../domain/types.js';
import { computeEventStats } from '../../../domain/stats.js';
import { STATUS_LABELS } from '../../../domain/types.js';
import {
  buildInviteUrl,
  CB,
  cbEventInfo,
  cbQuestionsModeShow,
  cbEventCard,
  cbEventClose,
  cbEventEdit,
  cbEventLink,
  cbEventPeople,
  cbEventRemind,
  cbRegBegin,
  cbRegChange,
  cbShopAdd,
  cbShopShow,
} from '../../callbacks.js';
import {
  cb,
  escapeMarkdown,
  link,
  mapLink,
  truncate,
  valueOrDash,
  withKeyboard,
  withMarkdownKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../message.js';
import type { EventDraftData } from '../../session.js';
import { type ViewOptions } from './common.js';

export const eventHeadline = (event: DosugEvent, tz: string, now = new Date()): string => {
  const startsAt = new Date(event.startsAt);
  const relative = startsAt.getTime() > now.getTime() ? ` (${formatRelative(now, startsAt, tz)})` : '';
  // Карту здесь не показываем: она приходит за час до встречи или по кнопке
  // «Доп. информация», чтобы ссылка не терялась в переписке.
  return [
    `Событие: ${event.title}`,
    `Когда: ${formatDateTime(startsAt, tz)}${relative}`,
    `Место: ${event.place}`,
  ].join('\n');
};

export const statsLine = (stats: EventStats): string => {
  const parts = [
    `идут ${stats.going}`,
    `под вопросом ${stats.maybe}`,
    `не идут ${stats.notGoing}`,
  ];
  if (stats.waitlisted > 0) parts.push(`лист ожидания ${stats.waitlisted}`);
  const limit = stats.limit === null
    ? 'без лимита'
    : `лимит ${stats.limit}${stats.free === null ? '' : `, свободно ${stats.free}`}`;
  return `Участники: ${parts.join(', ')}\n${limit}`;
};

const fieldsBlock = (event: DosugEvent): string => {
  const lines: string[] = [];
  if (event.description.trim()) lines.push('', `Описание: ${truncate(event.description, 600)}`);
  if (event.fields.length > 0) {
    const effective = resolveAnswerMode(event.fields, event.answerMode);
    lines.push(
      '',
      `Вопросы участникам (${event.fields.length}):`,
      `Отвечают ${EFFECTIVE_MODE_LABELS[effective]}.`,
    );
    event.fields.forEach((field, index) => lines.push(`${index + 1}. ${describeField(field)}`));
  } else {
    lines.push('', 'Вопросов участникам нет');
  }
  return lines.join('\n');
};

/** Экран «Доп. информация»: адрес с картой, описание, анкета, состав и покупки. */
export const eventDetails = (
  event: DosugEvent,
  participants: Participant[],
  items: ItemWithReservation[],
  options: ViewOptions,
): MessageContent => {
  // Адрес сам является ссылкой на карту: длинный URL в тексте не печатаем.
  const lines = [
    'Доп. информация о событии',
    '',
    `Событие: ${escapeMarkdown(event.title)}`,
    `Когда: ${formatDateTime(new Date(event.startsAt), options.tz)}`,
    `Адрес: ${mapLink(event.place, event.placeCoords)}`,
  ];
  if (event.organizerName) lines.push(`Организатор: ${event.organizerName}`);
  lines.push('', statsLine(computeEventStats(event, participants)));
  lines.push(fieldsBlock(event));

  const free = items.filter((item) => item.reservation === null);
  if (items.length > 0) {
    lines.push('', `Список покупок (${items.length}):`);
    items.forEach((item, index) => {
      const owner = item.reservation ? ` — ${item.reservation.userName}` : ' — свободно';
      lines.push(`${index + 1}. ${item.title}${owner}`);
    });
    if (free.length > 0) lines.push(`Свободно позиций: ${free.length}.`);
  }

  return withMarkdownKeyboard(lines.join('\n'), [
    [cb('Список покупок', cbShopShow(event.code)), cb('К событию', cbEventCard(event.code))],
    [cb('Частые вопросы', CB.menuFaq)],
  ]);
};

export const organizerEventCard = (
  event: DosugEvent,
  stats: EventStats,
  options: ViewOptions,
  itemCount = 0,
): MessageContent => {
  const lines = [eventHeadline(event, options.tz), '', statsLine(stats), fieldsBlock(event)];
  if (options.botUsername) {
    lines.push('', `Код события: ${event.code}`, `Ссылка для участников: ${buildInviteUrl(options.botUsername, event.code)}`);
  } else {
    lines.push('', `Код события: ${event.code}`, 'Ссылку для участников можно получить кнопкой ниже.');
  }

  // Пока список покупок пуст, не показываем его — чтобы не звать в пустой раздел.
  const rows: KeyboardRows = [
    [cb('Участники', cbEventPeople(event.code)), cb('Ссылка', cbEventLink(event.code))],
    itemCount > 0
      ? [cb('Список покупок', cbShopShow(event.code)), cb('Расчёты', `money:show:${event.code}`)]
      : [cb('Добавить список покупок', cbShopAdd(event.code))],
    [cb('Изменить', cbEventEdit(event.code)), cb('Напомнить сейчас', cbEventRemind(event.code))],
    [cb('Доп. информация', cbEventInfo(event.code)), cb('Способ ответа на анкету', cbQuestionsModeShow(event.code))],
    [cb('Завершить событие', cbEventClose(event.code)), cb('Все события', CB.menuEvents)],
  ];
  return withKeyboard(lines.join('\n'), rows);
};

export const participantEventCard = (
  event: DosugEvent,
  participant: Participant,
  options: ViewOptions,
  itemCount = 0,
): MessageContent => {
  const lines = [
    'Ваша заявка принята',
    '',
    eventHeadline(event, options.tz),
    '',
    `Статус: ${STATUS_LABELS[participant.status]}`,
  ];
  if (participant.waitlisted) {
    lines.push('Вы в листе ожидания: места закончились. Если кто-то откажется, бот напишет.');
  }
  if (event.fields.length > 0) {
    lines.push('', 'Ваши ответы:');
    for (const field of event.fields) {
      lines.push(`${field.label}: ${valueOrDash(participant.answers[field.id])}`);
    }
  }
  if (event.description.trim()) lines.push('', `Описание: ${truncate(event.description, 400)}`);

  const rows: KeyboardRows = [
    [
      cb('Иду', `reg:status:${event.code}:going`),
      cb('Под вопросом', `reg:status:${event.code}:maybe`),
      cb('Не смогу', `reg:status:${event.code}:not_going`),
    ],
    itemCount > 0
      ? [cb('Список покупок', `shop:show:${event.code}`), cb('Мои позиции', `shop:mine:${event.code}`)]
      : [cb('Доп. информация', cbEventInfo(event.code))],
    [cb('Изменить ответы', cbRegChange(event.code)), cb('К событию', cbEventCard(event.code))],
  ];
  if (options.answersUrl) {
    rows.splice(1, 0, [link('Заполнить анкету в приложении', options.answersUrl)]);
  }
  return withKeyboard(lines.join('\n'), rows);
};

export const invitationCard = (
  event: DosugEvent,
  stats: EventStats,
  options: ViewOptions,
): MessageContent => {
  const lines = [
    'Приглашение на событие',
    '',
    eventHeadline(event, options.tz),
    '',
    statsLine(stats),
    fieldsBlock(event),
  ];
  const rows: KeyboardRows = [
    options.answersUrl
      ? [link('Записатьcя и заполнить анкету', options.answersUrl)]
      : [cb('Записаться', cbRegBegin(event.code))],
    [
      cb('Доп. информация', cbEventInfo(event.code)),
      cb('Не смогу прийти', `reg:status:${event.code}:not_going`),
    ],
  ];
  return withKeyboard(lines.join('\n'), rows);
};
