import { FIELD_TYPE_LABELS } from '../../../../domain/types.js';
import {
  CB,
  cbDraftEditorCancel,
  cbDraftEditorSkip,
  cbDraftFieldMultiple,
  cbDraftFieldRequired,
  cbDraftFieldType,
} from '../../../callbacks.js';
import {
  cb,
  withKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../../message.js';
import type { FieldEditorHost, FieldEditorState } from '../../../session.js';

export const MAX_FIELDS = 10;
export const MAX_OPTIONS = 12;
export const MAX_LABEL = 140;
export const MAX_TEXT_LENGTH = 500;

const TYPE_BUTTONS: KeyboardRows = [
  [
    cb(FIELD_TYPE_LABELS.text, cbDraftFieldType('text')),
    cb(FIELD_TYPE_LABELS.number, cbDraftFieldType('number')),
  ],
  [
    cb(FIELD_TYPE_LABELS.choice, cbDraftFieldType('choice')),
    cb(FIELD_TYPE_LABELS.yesno, cbDraftFieldType('yesno')),
  ],
  [cb(FIELD_TYPE_LABELS.date, cbDraftFieldType('date'))],
  [cb('Отмена', CB.draftSkip)],
];

const MULTIPLE_BUTTONS: KeyboardRows = [
  [cb('Один вариант', cbDraftFieldMultiple(false)), cb('Несколько вариантов', cbDraftFieldMultiple(true))],
  [cb('Отмена', CB.draftSkip)],
];

const REQUIRED_BUTTONS: KeyboardRows = [
  [cb('Оставить обязательным', cbDraftFieldRequired(true))],
  [cb('Сделать необязательным', cbDraftFieldRequired(false))],
];

/**
 * У шага редактора свои payload'ы: иначе «Пропустить» ограничение и «Дальше»
 * мастера — одна и та же кнопка, и сохранение срабатывало посреди вопроса.
 */
const skipRow: KeyboardRows = [[cb('Пропустить', cbDraftEditorSkip())]];
const cancelRow: KeyboardRows = [[cb('Отмена', cbDraftEditorCancel())]];

export const parseNumberOrNull = (input: string): number | null | undefined => {
  const raw = input.trim().replace(',', '.');
  if (raw === '' || raw === '-' || raw === 'нет') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const startFieldEditor = (host: FieldEditorHost): MessageContent => {
  host.editor = { step: 'label', draft: {} };
  return withKeyboard(
    ['Новый вопрос', '', 'Отправьте текст вопроса, который увидит участник.'].join('\n'),
    cancelRow,
  );
};

export const renderEditorScreen = (editor: FieldEditorState): MessageContent => {
  const label = editor.draft.label ?? '';
  switch (editor.step) {
    case 'label':
      return withKeyboard('Новый вопрос\n\nОтправьте текст вопроса.', cancelRow);
    case 'type':
      return withKeyboard(`Вопрос: ${label}\n\nКак участник ответит?`, TYPE_BUTTONS);
    case 'options':
      return withKeyboard(
        [
          `Вопрос: ${label}`,
          '',
          `Перечислите варианты через запятую (до ${MAX_OPTIONS}).`,
        ].join('\n'),
        cancelRow,
      );
    case 'multiple':
      return withKeyboard(`Вопрос: ${label}\n\nСколько вариантов можно выбрать?`, MULTIPLE_BUTTONS);
    case 'minSelected':
      return withKeyboard(
        `Вопрос: ${label}\n\nСколько вариантов нужно выбрать минимально?\nОтправьте число или пропустите.`,
        skipRow,
      );
    case 'maxSelected':
      return withKeyboard(
        `Вопрос: ${label}\n\nСколько вариантов максимум?\nОтправьте число или пропустите.`,
        skipRow,
      );
    case 'min':
      return withKeyboard(
        `Вопрос: ${label}\n\nМинимальное число?\nОтправьте число или пропустите.`,
        skipRow,
      );
    case 'max':
      return withKeyboard(
        `Вопрос: ${label}\n\nМаксимальное число?\nОтправьте число или пропустите.`,
        skipRow,
      );
    case 'maxLength':
      return withKeyboard(
        `Вопрос: ${label}\n\nМаксимальная длина ответа в символах (до ${MAX_TEXT_LENGTH})?\nОтправьте число или пропустите.`,
        skipRow,
      );
    case 'required':
    default:
      return withKeyboard(
        `Вопрос: ${label}\n\nОн обязательный? По умолчанию да — как в формах, но можно снять.`,
        REQUIRED_BUTTONS,
      );
  }
};
