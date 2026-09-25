import { clampNumber, parseDecimal } from '../domain/text.js';
import { FIELD_TYPES, type AnswerMode, type FieldType } from '../domain/types.js';
import { MINIAPP_MAX_FIELDS, MINIAPP_MAX_LABEL, MINIAPP_MAX_OPTIONS } from './questionsPage.js';
import type { MiniappField } from './contracts.js';

/**
 * Приведение присланных из мини-приложения данных к безопасному виду: списки
 * вопросов и способ ответа. Всё, что не проходит проверку, отклоняется с понятной
 * ошибкой — страница показывает её организатору.
 */

export const toBoundedNumber = (value: unknown, min: number, max: number): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseDecimal(value);
  return parsed === null ? null : clampNumber(parsed, min, max);
};

/** Приводит присланные из мини-приложения вопросы к безопасному виду. */
export const sanitizeFields = (raw: unknown): { fields: MiniappField[]; error?: string } => {
  if (!Array.isArray(raw)) return { fields: [], error: 'Ожидался список вопросов' };
  if (raw.length === 0) return { fields: [], error: 'Добавьте хотя бы один вопрос' };
  if (raw.length > MINIAPP_MAX_FIELDS) {
    return { fields: [], error: `Не больше ${MINIAPP_MAX_FIELDS} вопросов` };
  }

  const fields: MiniappField[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim().slice(0, MINIAPP_MAX_LABEL) : '';
    if (!label) return { fields: [], error: 'У каждого вопроса должен быть текст' };

    const type = FIELD_TYPES.includes(candidate.type as FieldType) ? (candidate.type as FieldType) : 'text';
    const options = Array.isArray(candidate.options)
      ? candidate.options
          .filter((option): option is string => typeof option === 'string')
          .map((option) => option.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, MINIAPP_MAX_OPTIONS)
      : [];

    if (type === 'choice' && options.length < 2) {
      return { fields: [], error: `Для вопроса «${label}» нужно минимум два варианта` };
    }

    const multiple = type === 'choice' ? Boolean(candidate.multiple) : false;
    const minSelected = multiple ? toBoundedNumber(candidate.minSelected, 0, options.length) : null;
    const maxSelected = multiple
      ? toBoundedNumber(candidate.maxSelected, 1, options.length) ?? options.length
      : null;
    if (minSelected !== null && maxSelected !== null && minSelected > maxSelected) {
      return { fields: [], error: `У вопроса «${label}» минимум больше максимума` };
    }

    const min = type === 'number' ? toBoundedNumber(candidate.min, -1_000_000, 1_000_000) : null;
    const max = type === 'number' ? toBoundedNumber(candidate.max, -1_000_000, 1_000_000) : null;
    if (min !== null && max !== null && min > max) {
      return { fields: [], error: `У вопроса «${label}» минимум больше максимума` };
    }

    const maxLength = type === 'text' ? toBoundedNumber(candidate.maxLength, 1, 500) : null;

    fields.push({
      label,
      type,
      options,
      multiple,
      minSelected,
      maxSelected,
      min,
      max,
      maxLength,
      // Поля по умолчанию обязательные, как и просили: необязательность — осознанный выбор.
      required: candidate.required === undefined ? true : Boolean(candidate.required),
    });
  }

  if (fields.length === 0) return { fields: [], error: 'Добавьте хотя бы один вопрос' };
  return { fields };
};

export const sanitizeAnswerMode = (raw: unknown): AnswerMode =>
  raw === 'chat' || raw === 'miniapp' ? raw : 'auto';

/**
 * HTTP-сервер мини-приложения конструктора вопросов. Живёт в том же процессе, что и
 * бот, поэтому отдельного сервиса в compose не требуется: страница и API — на одном
 * порту (MINIAPP_PORT).
 */
