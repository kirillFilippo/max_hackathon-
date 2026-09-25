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
import {
  CB,
  cbDraftFieldRemove,
  cbQuestionsApp,
  cbQuestionsModeShow,
  cbEventCard,
  cbEventEditField,
} from '../../callbacks.js';
import { cb, truncate, withKeyboard, type KeyboardRows, type MessageContent } from '../../message.js';
import type { EventDraftData } from '../../session.js';
import { MAX_EDITOR_FIELDS } from './common.js';

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
    .slice(0, MAX_EDITOR_FIELDS)
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
