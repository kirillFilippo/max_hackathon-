/**
 * Приведение пользовательского текста к виду для сравнения.
 *
 * Люди пишут «Ёлка» и «елка», «Да» и «да », ставят лишние пробелы — сравнивать
 * это нужно одинаково во всех сценариях: разбор даты, ответ на вопрос, поиск по
 * FAQ. Раньше нормализация была скопирована в четырёх модулях и успела разойтись.
 */
export const normalizeUserText = (value: string): string =>
  value.toLowerCase().replace(/ё/g, 'е').trim();

/** То же, но внутренние пробелы схлопываются: «завтра   19:00» → «завтра 19:00». */
export const normalizeUserTextSpaces = (value: string): string =>
  normalizeUserText(value).replace(/\s+/g, ' ');

/** Вариант без пробелов вообще: «1 200,50» → «1200,50». */
export const normalizeUserTextTight = (value: string): string =>
  normalizeUserText(value).replace(/\s|\u00a0/g, '');

/**
 * Разбирает число из пользовательского ввода: «2,5», «1 200», «-3».
 * Возвращает null, если это не число. Одна реализация на ответы участника
 * и ограничения вопросов из чата и мини-приложения.
 */
export const parseDecimal = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = normalizeUserTextTight(value).replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Ограничивает число диапазоном: используется для проверки присланных лимитов. */
export const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
