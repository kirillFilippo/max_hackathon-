import { newFieldId } from '../../../../domain/ids.js';
import { normalizeField } from '../../../../domain/questionnaire.js';
import { FIELD_TYPE_LABELS, type FieldType } from '../../../../domain/types.js';
import type { FieldEditorHost, FieldEditorState } from '../../../session.js';

import {
  MAX_LABEL,
  MAX_OPTIONS,
  MAX_TEXT_LENGTH,
  parseNumberOrNull,
} from './screens.js';

const commitField = (host: FieldEditorHost): void => {
  const draft = host.editor?.draft;
  if (!draft?.label || !draft.type) {
    host.editor = null;
    return;
  }
  host.fields.push(
    normalizeField({
      id: newFieldId(),
      label: draft.label,
      type: draft.type,
      options: (draft.options ?? []).slice(0, MAX_OPTIONS),
      multiple: draft.multiple ?? false,
      minSelected: draft.minSelected ?? null,
      maxSelected: draft.maxSelected ?? null,
      min: draft.min ?? null,
      max: draft.max ?? null,
      maxLength: draft.maxLength ?? null,
      required: draft.required ?? true,
    }),
  );
  host.editor = null;
};

/** Следующий шаг редактора зависит от типа вопроса. */
const nextStepAfterType = (type: FieldType): FieldEditorState['step'] => {
  switch (type) {
    case 'choice':
      return 'options';
    case 'number':
      return 'min';
    case 'text':
      return 'maxLength';
    default:
      return 'required';
  }
};

const advance = (editor: FieldEditorState, from: FieldEditorState['step']): void => {
  switch (from) {
    case 'options':
      editor.step = 'multiple';
      return;
    case 'multiple':
      editor.step = editor.draft.multiple ? 'minSelected' : 'required';
      return;
    case 'minSelected':
      editor.step = 'maxSelected';
      return;
    case 'maxSelected':
      editor.step = 'required';
      return;
    case 'min':
      editor.step = 'max';
      return;
    case 'max':
    case 'maxLength':
      editor.step = 'required';
      return;
    default:
      editor.step = 'required';
  }
};

export const parseOptions = (input: string): string[] =>
  input
    .split(/[,;|\n]/)
    .map((option) => option.trim())
    .filter((option) => option.length > 0)
    .slice(0, MAX_OPTIONS);

/** Обрабатывает callback редактора. Возвращает true, если событие поглощено. */
export const handleFieldEditorCallback = (
  host: FieldEditorHost,
  action: string,
  args: string[],
): boolean => {
  const editor = host.editor;
  if (!editor || action !== 'draft') return false;

  const command = args[0];
  if (command === 'editorcancel') {
    // Пользователь отказался от вопроса.
    host.editor = null;
    return true;
  }
  if (command === 'editorskip') {
    if (editor.step === 'label' || editor.step === 'type' || editor.step === 'options') {
      host.editor = null;
      return true;
    }
    if (editor.step === 'required') {
      // Пропуск на последнем шаге = «оставить обязательным»: вопрос добавляется.
      editor.draft.required = true;
      commitField(host);
      return true;
    }
    advance(editor, editor.step);
    return true;
  }
  if (command === 'fieldtype' && editor.step === 'type') {
    const type = args[1] as FieldType | undefined;
    if (!type || !(type in FIELD_TYPE_LABELS)) return true;
    editor.draft.type = type;
    editor.step = nextStepAfterType(type);
    return true;
  }
  if (command === 'fieldmulti' && editor.step === 'multiple') {
    editor.draft.multiple = args[1] === 'yes';
    editor.step = editor.draft.multiple ? 'minSelected' : 'required';
    return true;
  }
  if (command === 'fieldreq' && editor.step === 'required') {
    editor.draft.required = args[1] === 'yes';
    commitField(host);
    return true;
  }
  return false;
};

/** Обрабатывает текстовый ввод редактора. Возвращает true, если ввод поглощён. */
export const handleFieldEditorText = (host: FieldEditorHost, input: string): boolean => {
  const editor = host.editor;
  if (!editor) return false;
  const value = input.trim();

  switch (editor.step) {
    case 'label': {
      if (!value) return true;
      editor.draft.label = value.slice(0, MAX_LABEL);
      editor.step = 'type';
      return true;
    }
    case 'options': {
      const options = parseOptions(value);
      if (options.length < 2) return true;
      editor.draft.options = options;
      editor.step = 'multiple';
      return true;
    }
    case 'minSelected':
    case 'maxSelected': {
      const parsed = parseNumberOrNull(value);
      if (parsed === undefined) return true;
      const bounded =
        parsed === null ? null : Math.max(0, Math.min(Math.trunc(parsed), (editor.draft.options ?? []).length));
      if (editor.step === 'minSelected') editor.draft.minSelected = bounded;
      else editor.draft.maxSelected = bounded;
      advance(editor, editor.step);
      return true;
    }
    case 'min':
    case 'max': {
      const parsed = parseNumberOrNull(value);
      if (parsed === undefined) return true;
      if (editor.step === 'min') editor.draft.min = parsed;
      else editor.draft.max = parsed;
      advance(editor, editor.step);
      return true;
    }
    case 'maxLength': {
      const parsed = parseNumberOrNull(value);
      if (parsed === undefined) return true;
      editor.draft.maxLength =
        parsed === null ? null : Math.max(1, Math.min(Math.trunc(parsed), MAX_TEXT_LENGTH));
      advance(editor, editor.step);
      return true;
    }
    default:
      return false;
  }
};

export { MAX_TEXT_LENGTH };
