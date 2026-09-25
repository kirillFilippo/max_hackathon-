import {
  formatDateTime,
  formatDateTimeShort,
  formatRelative,
} from '../../domain/datetime.js';
import { describeField } from '../../domain/presets.js';
import {
  EFFECTIVE_MODE_LABELS,
  resolveAnswerMode,
} from '../../domain/questionnaire.js';
import type {
  AnswerMode,
  DosugEvent,
  EventField,
  EventStats,
  ItemWithReservation,
  Participant,
  PlaceCoords,
  Template,
} from '../../domain/types.js';
import { computeEventStats } from '../../domain/stats.js';
import { STATUS_LABELS } from '../../domain/types.js';
import {
  buildInviteUrl,
  CB,
  cbDraftFieldRemove,
  cbEventInfo,
  cbQuestionsApp,
  cbQuestionsModeShow,
  cbEventCard,
  cbEventClose,
  cbEventEdit,
  cbEventEditField,
  cbEventLink,
  cbEventPeople,
  cbEventRemind,
  cbRegBegin,
  cbRegChange,
  cbShopAdd,
  cbShopShow,
} from '../callbacks.js';
import {
  button,
  cb,
  chunk,
  escapeMarkdown,
  link,
  mapLink,
  truncate,
  valueOrDash,
  withKeyboard,
  withMarkdownKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../message.js';
import type { EventDraftData } from '../session.js';
import { isGoing } from '../../domain/stats.js';

export interface ViewOptions {
  tz: string;
  botUsername?: string;
  /** Режим анкеты — нужен для сводки создания события. */
  answerMode?: AnswerMode;
  /** Диплинк мини-приложения с анкетой, когда участники отвечают там. */
  answersUrl?: string;
}

const MAX_LISTED = 15;

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

export const placePrompt = (): MessageContent =>
  withKeyboard(
    [
      'Шаг 3 из 6. Где встречаемся?',
      '',
      'Напишите адрес или отправьте геопозицию кнопкой ниже.',
      'Бот покажет точку на Яндекс.Картах и попросит подтвердить адрес.',
    ].join('\n'),
    [
      [button.requestGeoLocation('Отправить геопозицию')],
      [cb('Отмена', CB.draftCancel)],
    ],
  );

/** Экран подтверждения адреса: адрес-ссылка на карту и замечание, если ввод похож не на адрес. */
export const placeConfirm = (
  place: string,
  coords: PlaceCoords | null,
  warning: string | null,
): MessageContent => {
  const lines = ['Проверьте адрес', '', mapLink(place, coords)];
  if (warning) lines.push('', `Замечание: ${escapeMarkdown(warning)}`);
  lines.push('', 'Нажмите на адрес, чтобы открыть карту, и убедитесь, что точка верная.');

  const rows: KeyboardRows = [
    [cb('Адрес верный', CB.draftPlaceOk)],
    [cb('Ввести заново', CB.draftPlaceRetry)],
    [button.requestGeoLocation('Уточнить геопозицией'), cb('Отмена', CB.draftCancel)],
  ];
  return withMarkdownKeyboard(lines.join('\n'), rows);
};

export const createSummary = (
  data: EventDraftData,
  fields: EventField[],
  options: ViewOptions,
): MessageContent => {
  const lines = [
    'Проверьте событие',
    '',
    `Название: ${valueOrDash(data.title)}`,
    `Когда: ${data.startsAt ? formatDateTime(data.startsAt, options.tz) : '—'}`,
    `Место: ${valueOrDash(data.place)}`,
    `Лимит: ${data.limit === null || data.limit === undefined ? 'без лимита' : `${data.limit} человек`}`,
  ];
  if (data.description?.trim()) lines.push(`Описание: ${truncate(data.description, 300)}`);
  const effective = resolveAnswerMode(fields, options.answerMode ?? 'auto');
  lines.push('', `Вопросы участникам: ${fields.length} (отвечают ${EFFECTIVE_MODE_LABELS[effective]})`);
  fields.forEach((field, index) => lines.push(`${index + 1}. ${describeField(field)}`));

  return withKeyboard(lines.join('\n'), [
    [cb('Опубликовать', CB.draftPublish)],
    [cb('Вернуться к вопросам', CB.draftBack), cb('Отмена', CB.draftCancel)],
  ]);
};

export const fieldsEditor = (
  fields: EventField[],
  answerMode: AnswerMode = 'auto',
): MessageContent => {
  const effective = resolveAnswerMode(fields, answerMode);
  const lines = [
    'Вопросы участникам',
    `Отвечают ${EFFECTIVE_MODE_LABELS[effective]}.`,
    'Вопросы по умолчанию обязательные; обязательность снимается при создании вопроса.',
    '',
  ];
  if (fields.length === 0) {
    lines.push('Пока вопросов нет: нажмите «Добавить вопрос».');
  } else {
    fields.forEach((field, index) => lines.push(`${index + 1}. ${describeField(field)}`));
  }

  return withKeyboard(lines.join('\n'), fieldsEditorRows(fields, 'draft'));
};

/**
 * Кнопки экрана вопросов: удалить каждый вопрос, добавить новый, перейти дальше.
 * Подсказок-заготовок здесь нет намеренно — список кнопок разрастался и мешал.
 */
const fieldsEditorRows = (fields: EventField[], scope: string): KeyboardRows => {
  const rows: KeyboardRows = fields
    .slice(0, 8)
    .map((field, index) => [cb(`Удалить: ${truncate(field.label, 24)}`, cbDraftFieldRemove(index))]);
  rows.push([cb('Добавить вопрос', CB.draftFieldAdd), cb('Готово', CB.draftSkip)]);
  rows.push([
    cb('Конструктор в приложении', cbQuestionsApp(scope)),
    cb('Способ ответа', cbQuestionsModeShow(scope)),
  ]);
  return rows;
};

export const editMenu = (event: DosugEvent): MessageContent =>
  withKeyboard(
    [
      `Что меняем в событии «${event.title}»?`,
      '',
      'После сохранения бот уведомит участников об изменениях.',
    ].join('\n'),
    [
      [cb('Дата и время', cbEventEditField(event.code, 'startsAt')), cb('Место', cbEventEditField(event.code, 'place'))],
      [cb('Описание', cbEventEditField(event.code, 'description')), cb('Название', cbEventEditField(event.code, 'title'))],
      [cb('Лимит участников', cbEventEditField(event.code, 'limit'))],
      [cb('К событию', cbEventCard(event.code))],
    ],
  );

export const templatesList = (custom: Template[], presets: Template[]): MessageContent => {
  const lines = [
    'Наборы вопросов',
    '',
    'Шаблон — это список вопросов, которые участник заполняет при регистрации.',
    'Предустановленные:',
  ];
  presets.forEach((template) => lines.push(`  ${template.name} — ${template.fields.length} вопроса`));
  lines.push('', `Ваши шаблоны (${custom.length}):`);
  if (custom.length === 0) {
    lines.push('  пока нет');
  } else {
    custom.forEach((template) => lines.push(`  ${template.name} — ${template.fields.length} вопроса`));
  }

  const rows: KeyboardRows = custom
    .slice(0, 6)
    .map((template) => [cb(truncate(template.name, 30), `tpl:use:${template.id}`)]);
  // Набор вопросов можно собрать и из меню, не создавая событие.
  rows.push([cb('Создать набор вопросов', CB.templateNew)]);
  rows.push([cb('В меню', CB.menuMain)]);
  return withKeyboard(lines.join('\n'), rows);
};

export const templateCard = (template: Template): MessageContent => {
  const lines = [`Шаблон: ${template.name}`, ''];
  if (template.fields.length === 0) {
    lines.push('Вопросов нет.');
  } else {
    template.fields.forEach((field, index) => lines.push(`${index + 1}. ${describeField(field)}`));
  }

  if (template.builtin) {
    lines.push('', 'Предустановленный шаблон: его можно выбрать при создании события, но нельзя изменить.');
    return withKeyboard(lines.join('\n'), [[cb('К шаблонам', CB.menuTemplates)]]);
  }

  return withKeyboard(lines.join('\n'), [
    [cb('Изменить вопросы', `tpl:edit:${template.id}`), cb('Переименовать', `tpl:rename:${template.id}`)],
    [cb('Удалить', `tpl:delete:${template.id}`)],
    [cb('К шаблонам', CB.menuTemplates)],
  ]);
};

export const templateFieldsEditor = (name: string, fields: EventField[]): MessageContent => {
  const lines = [`Набор «${name}»`, ''];
  if (fields.length === 0) {
    lines.push('Пока вопросов нет: нажмите «Добавить вопрос» или соберите набор в приложении.');
  } else {
    fields.forEach((field, index) => lines.push(`${index + 1}. ${describeField(field)}`));
  }

  const rows: KeyboardRows = fields
    .slice(0, 8)
    .map((field, index) => [cb(`Удалить: ${truncate(field.label, 24)}`, cbDraftFieldRemove(index))]);
  rows.push([cb('Добавить вопрос', CB.draftFieldAdd), cb('Конструктор в приложении', cbQuestionsApp('draft'))]);
  rows.push([cb('Сохранить', CB.draftSkip)]);
  return withKeyboard(lines.join('\n'), rows);
};

export const eventLinkText = (event: DosugEvent, linkUrl: string | null, code: string): string => {
  const lines = [`Приглашение на «${event.title}»`, ''];
  if (linkUrl) lines.push(linkUrl);
  else lines.push('Ник бота неизвестен, используйте код события.');
  lines.push('', `Код события: ${code}`, `Участник может отправить боту /join ${code}`, '', 'Ссылку можно переслать в любой чат MAX.');
  return lines.join('\n');
};
