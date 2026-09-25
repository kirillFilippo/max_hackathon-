import { normalizeUserText, normalizeUserTextSpaces, normalizeUserTextTight } from './text.js';
import { FIELD_TYPE_LABELS, type EventField } from './types.js';

/**
 * Ограничения ответов на вопрос — как в формах: обязательность, границы числа,
 * максимальная длина текста, один или несколько вариантов с границами, дата.
 * Одна реализация используется и чатом, и мини-приложением.
 */

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const MAX_TEXT_LENGTH = 500;

const isBlank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim() === '';

const parseNumber = (input: string): number | null => {
  const normalized = normalizeUserTextTight(input).replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

const parseDate = (input: string): string | null => {
  const raw = normalizeUserTextSpaces(input);

  let day: number;
  let month: number;
  let year: number;
  const now = new Date();

  if (raw.includes('-') && /^\d{4}-/.test(raw)) {
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
    if (!iso) return null;
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const numeric = /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/.exec(raw);
    if (!numeric) return null;
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(day)}.${pad(month)}.${year}`;
};

/**
 * Разбирает выбор для поля с несколькими вариантами: «1 3», «1,3», «Снеки, Напитки»
 * или один вариант целиком. Мини-приложение присылает текст вариантов через запятую,
 * поэтому вариант из нескольких слов («Настольные игры») обязан переживать разбор:
 * режем по разделителям, а по пробелам — только если иначе не получилось.
 */
export const parseChoiceSelection = (field: EventField, input: string): string[] => {
  const raw = input.trim();
  if (raw === '') return [];

  const options = field.options;
  const lowered = options.map((option) => option.toLowerCase());
  const matchOption = (token: string): string | undefined => {
    const index = lowered.indexOf(token.trim().toLowerCase());
    return index >= 0 ? options[index] : undefined;
  };
  // Ответ храним в порядке анкеты: так он читается одинаково в чате, панели и выгрузке.
  const canonical = (picked: string[]): string[] => {
    const set = new Set(picked);
    return options.filter((option) => set.has(option));
  };

  // Один вариант целиком: так приходит ответ, выбранный кнопкой в мини-приложении.
  const whole = matchOption(raw);
  if (whole !== undefined) return [whole];

  // Варианты через запятую или точку с запятой: здесь пробелы — часть названия.
  const bySeparator = raw.split(/[,;]/).map((token) => token.trim()).filter(Boolean);
  if (bySeparator.length > 1) {
    const picked = bySeparator.map(matchOption);
    if (picked.every((option): option is string => option !== undefined)) {
      return canonical(picked);
    }
  }

  // Смешанный ввод: номер варианта («1 3») или название, разделённое пробелами.
  const tokens = raw.split(/[,;]|\s+/).map((token) => token.trim()).filter(Boolean);
  const picked = tokens
    .map((token) => {
      if (!/^\d{1,2}$/.test(token)) return matchOption(token);
      return options[Number(token) - 1] ?? matchOption(token);
    })
    .filter((option): option is string => option !== undefined);
  return canonical(picked);
};

export const describeConstraints = (field: EventField): string => {
  const parts: string[] = [FIELD_TYPE_LABELS[field.type]];
  if (field.type === 'number') {
    if (field.min !== null && field.max !== null) parts.push(`от ${field.min} до ${field.max}`);
    else if (field.min !== null) parts.push(`не меньше ${field.min}`);
    else if (field.max !== null) parts.push(`не больше ${field.max}`);
  }
  if (field.type === 'text') {
    parts.push(field.maxLength === null ? 'до 500 символов' : `до ${field.maxLength} символов`);
  }
  if (field.type === 'date') parts.push('в формате ДД.ММ.ГГГГ');
  if (field.type === 'choice') {
    parts.push(field.multiple ? 'можно выбрать несколько' : 'один вариант');
    if (field.multiple) {
      if (field.minSelected !== null && field.maxSelected !== null) {
        parts.push(`от ${field.minSelected} до ${field.maxSelected}`);
      } else if (field.minSelected !== null) {
        parts.push(`не меньше ${field.minSelected}`);
      } else if (field.maxSelected !== null) {
        parts.push(`не больше ${field.maxSelected}`);
      }
    }
  }
  if (!field.required) parts.push('необязательный');
  return parts.join(', ');
};

/** Проверяет один ответ и возвращает нормализованное значение. */
export const validateAnswer = (field: EventField, input: string | null | undefined): ValidationResult => {
  const raw = input ?? '';

  if (isBlank(raw)) {
    if (field.required) return { ok: false, error: 'Вопрос обязательный: ответьте или сделайте его необязательным.' };
    return { ok: true, value: '' };
  }

  switch (field.type) {
    case 'number': {
      const value = parseNumber(raw);
      if (value === null) return { ok: false, error: 'Нужно число, например 3 или 2,5.' };
      if (field.min !== null && value < field.min) return { ok: false, error: `Слишком мало: минимум ${field.min}.` };
      if (field.max !== null && value > field.max) return { ok: false, error: `Слишком много: максимум ${field.max}.` };
      return { ok: true, value: String(value) };
    }

    case 'date': {
      const value = parseDate(raw);
      if (!value) return { ok: false, error: 'Нужна дата в формате ДД.ММ.ГГГГ, например 25.10.2026.' };
      return { ok: true, value };
    }

    case 'text': {
      const value = raw.trim();
      const limit = field.maxLength ?? MAX_TEXT_LENGTH;
      if (value.length > limit) {
        return { ok: false, error: `Слишком длинный ответ: максимум ${limit} символов.` };
      }
      return { ok: true, value };
    }

    case 'yesno': {
      const value = normalizeUserText(raw);
      if (['да', 'yes', '+', 'true', '1'].includes(value)) return { ok: true, value: 'Да' };
      if (['нет', 'no', '-', 'false', '0'].includes(value)) return { ok: true, value: 'Нет' };
      return { ok: false, error: 'Ответьте «Да» или «Нет».' };
    }

    case 'choice':
    default: {
      if (field.options.length === 0) return { ok: true, value: raw.trim() };

      if (!field.multiple) {
        if (field.options.some((option) => option.toLowerCase() === raw.trim().toLowerCase())) {
          const option = field.options.find((item) => item.toLowerCase() === raw.trim().toLowerCase())!;
          return { ok: true, value: option };
        }
        const index = Number(raw.trim());
        if (Number.isInteger(index) && index >= 1 && index <= field.options.length) {
          return { ok: true, value: field.options[index - 1]! };
        }
        return { ok: false, error: `Выберите один из вариантов: ${field.options.join(', ')}.` };
      }

      const picked = parseChoiceSelection(field, raw);
      if (picked.length === 0) {
        return { ok: false, error: `Выберите варианты: ${field.options.join(', ')}.` };
      }
      const min = field.minSelected ?? (field.required ? 1 : 0);
      const max = field.maxSelected ?? field.options.length;
      if (picked.length < min) return { ok: false, error: `Нужно выбрать не меньше ${min}.` };
      if (picked.length > max) return { ok: false, error: `Можно выбрать не больше ${max}.` };
      return { ok: true, value: picked.join(', ') };
    }
  }
};

export interface AnswersValidation {
  ok: boolean;
  answers: Record<string, string>;
  /** Первое поле с ошибкой — чтобы показать её пользователю. */
  failedField?: EventField;
  error?: string;
}

/** Проверяет весь набор ответов: пустые необязательные поля просто пропускаются. */
export const validateAnswers = (
  fields: EventField[],
  answers: Record<string, string>,
): AnswersValidation => {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const validation = validateAnswer(field, answers[field.id]);
    if (!validation.ok) {
      return { ok: false, answers: result, failedField: field, error: validation.error };
    }
    if (validation.value !== '') result[field.id] = validation.value;
  }
  return { ok: true, answers: result };
};
