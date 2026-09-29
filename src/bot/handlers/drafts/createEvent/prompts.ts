import { formatDate } from '../../../../domain/datetime/index.js';
import { CB, cbDraftTemplate } from '../../../callbacks.js';
import type { AppDeps } from '../../../deps.js';
import {
  cancelRow,
  cb,
  chunk,
  truncate,
  withKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../../message.js';



export const promptTitle = (): MessageContent =>
  withKeyboard('Новое событие\n\nШаг 1 из 6. Как назовём событие?', cancelRow);

export const promptDatetime = (): MessageContent =>
  withKeyboard(
    'Шаг 2 из 6. Когда встречаемся?\n\nНапишите дату и время сообщением.',
    cancelRow,
  );

export const promptTime = (date: Date, tz: string): MessageContent =>
  withKeyboard(
    [
      `Дата: ${formatDate(date, tz)}`,
      '',
      'Во сколько начало? Напишите время, например «19:00» или «в 11».',
    ].join('\n'),
    cancelRow,
  );

export const promptDescription = (): MessageContent =>
  withKeyboard(
    'Шаг 4 из 6. Описание для участников.\n\nМожно пропустить.',
    [[cb('Пропустить', CB.draftSkip)], ...cancelRow],
  );

export const promptLimit = (): MessageContent =>
  withKeyboard(
    'Шаг 5 из 6. Сколько участников ждём?\n\nНапишите число или «нет», если без ограничения.',
    [[cb('Без ограничения', CB.draftSkip)], ...cancelRow],
  );

export const promptTemplate = async (deps: AppDeps, userId: number): Promise<MessageContent> => {
  const options = await deps.templates.options(userId);
  const rows: KeyboardRows = chunk(options, 2).map((pair) =>
    pair.map((option) => cb(truncate(option.name, 22), cbDraftTemplate(option.id))),
  );
  rows.push([cb('Без вопросов', CB.draftTemplateNone), cb('Свои вопросы', CB.draftTemplateOwn)]);
  rows.push(...cancelRow);
  return withKeyboard(
    [
      'Шаг 6 из 6. Вопросы участникам.',
      '',
      'Выберите готовый набор или продолжайте без вопросов.',
      'Дальше вопросы собираются в мини-приложении: типы и ограничения ответов задаются там.',
    ].join('\n'),
    rows,
  );
};

export const promptSaveTemplate = (proposedName?: string | null): MessageContent => {
  if (proposedName) {
    return withKeyboard(
      [
        `Название набора: ${proposedName}`,
        '',
        'Сохранить его как шаблон для будущих событий?',
        'Или отправьте другое название сообщением.',
      ].join('\n'),
      [
        [cb(`Сохранить шаблон «${truncate(proposedName, 24)}»`, CB.draftSaveTemplate)],
        [cb('Не сохранять', CB.draftSkip)],
      ],
    );
  }

  return withKeyboard(
    [
      'Сохранить эти вопросы как шаблон?',
      '',
      'Шаблон пригодится для следующих событий: не придётся заводить вопросы заново.',
      'Отправьте название шаблона или нажмите «Не сохранять».',
    ].join('\n'),
    [[cb('Не сохранять', CB.draftSkip)]],
  );
};
