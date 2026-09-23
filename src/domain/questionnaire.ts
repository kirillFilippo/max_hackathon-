import type { AnswerMode, EffectiveAnswerMode, EventField, FieldType } from './types.js';

/**
 * Вес анкеты определяет, где участник отвечает на вопросы: лёгкую анкету
 * заполняют прямо в чате, тяжёлую — в мини-приложении (список вопросов одним
 * экраном). Порог и формула согласованы с командой:
 *
 *   число  → 2
 *   текст  → 5
 *   дата   → 2
 *   да/нет → 1
 *   выбор  → floor(число вариантов / 3) + 1
 */
export const CHAT_WEIGHT_LIMIT = 10;

export const fieldWeight = (field: Pick<EventField, 'type' | 'options'>): number => {
  switch (field.type) {
    case 'text':
      return 5;
    case 'number':
    case 'date':
      return 2;
    case 'choice':
      return Math.floor(field.options.length / 3) + 1;
    case 'yesno':
    default:
      return 1;
  }
};

export const questionnaireWeight = (fields: Array<Pick<EventField, 'type' | 'options'>>): number =>
  fields.reduce((sum, field) => sum + fieldWeight(field), 0);

/** Итоговый режим: авто-выбор сравнивает вес с порогом. */
export const resolveAnswerMode = (
  fields: Array<Pick<EventField, 'type' | 'options'>>,
  mode: AnswerMode = 'auto',
): EffectiveAnswerMode => {
  if (mode === 'chat' || mode === 'miniapp') return mode;
  return questionnaireWeight(fields) < CHAT_WEIGHT_LIMIT ? 'chat' : 'miniapp';
};

export const ANSWER_MODE_LABELS: Record<AnswerMode, string> = {
  auto: 'Автоматически',
  chat: 'Всегда в чате',
  miniapp: 'Всегда в мини-приложении',
};

export const EFFECTIVE_MODE_LABELS: Record<EffectiveAnswerMode, string> = {
  chat: 'в чате',
  miniapp: 'в мини-приложении',
};

/** Приводит поле из БД к актуальному виду: старые записи не знают о новых полях. */
export const normalizeField = (raw: Partial<EventField> & { type: FieldType }): EventField => {
  const type = raw.type;
  return {
    id: raw.id ?? '',
    label: raw.label ?? '',
    type,
    options: Array.isArray(raw.options) ? raw.options : [],
    multiple: raw.multiple ?? false,
    minSelected: raw.minSelected ?? null,
    maxSelected: raw.maxSelected ?? null,
    min: raw.min ?? null,
    max: raw.max ?? null,
    maxLength: raw.maxLength ?? null,
    required: raw.required ?? true,
  };
};

export const normalizeFields = (raw: unknown): EventField[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is EventField => Boolean(item) && typeof item === 'object' && 'type' in item)
    .map((item) => normalizeField(item));
};

/** Новое поле: обязательное по умолчанию, без ограничений. */
export const createEmptyField = (label: string, type: FieldType): EventField =>
  normalizeField({ id: '', label, type });

/**
 * Отпечаток анкеты: нужен, чтобы понять, менял ли организатор вопросы после
 * выбора готового набора. Служебные `id` в отпечаток не входят — они новые
 * у каждого поля, и из-за них «ничего не менял» выглядело бы как изменение.
 */
export const questionnaireFingerprint = (fields: EventField[]): string =>
  JSON.stringify(
    fields.map((field) => [
      field.label.trim(),
      field.type,
      [...field.options],
      field.multiple,
      field.minSelected,
      field.maxSelected,
      field.min,
      field.max,
      field.maxLength,
      field.required,
    ]),
  );
