/**
 * Разбор «человеческой» даты: «завтра 19:00», «25.10 18:30», «25 октября 19:00»,
 * а также лимита участников («нет», «6»). На выходе — момент в UTC: в базе
 * всегда UTC, а «настенное» время живёт только на вводе и выводе.
 */
import { DEFAULT_TIME, MONTH_ALIASES, tzParts, zonedToUtc } from './format.js';

export { DEFAULT_TIME };

export interface ParsedDateTime {
  date: Date;
  /** false, если время не указано и подставлено DEFAULT_TIME. */
  hadTime: boolean;
}

export interface ParseOptions {
  now?: Date;
  tz?: string;
}

/**
 * Приводит ввод к виду, который понимают шаблоны ниже. Предлоги «в» и «к» перед
 * временем отбрасываем здесь, а не в каждом шаблоне: организатор пишет и
 * «завтра 19:00», и «завтра в 19:00», и «сегодня к 9».
 */
const normalizeInput = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^| )(в|к) +(?=\d{1,2}([:.]\d{2})?$)/g, '$1');

const buildDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date | null => {
  const date = zonedToUtc(year, month, day, hour, minute, tz);
  const check = tzParts(date, tz);
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  return date;
};

/**
 * Понимает форматы:
 *  - «25.10 19:00», «25.10.2025 19:00», «25/10 18:30»
 *  - «2025-10-25 19:00»
 *  - «25 октября 19:00», «25 октября 2025 19:00»
 *  - «сегодня 20:00», «завтра 11:00», «послезавтра»
 *  - «завтра в 11:00», «сегодня к 9», «25.10 в 18:30» — предлог «в»/«к» не обязателен
 *  - «19:00» — сегодня, а если время прошло — завтра
 */
export const parseUserDateTime = (input: string, options: ParseOptions = {}): ParsedDateTime | null => {
  const tz = options.tz ?? 'Europe/Moscow';
  const now = options.now ?? new Date();
  const raw = normalizeInput(input).replace(/^в /, '');
  if (!raw) return null;

  const nowParts = tzParts(now, tz);
  const todayStart = zonedToUtc(nowParts.year, nowParts.month, nowParts.day, 0, 0, tz);

  const numeric = /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?(?: (\d{1,2})[:.](\d{2}))?$/.exec(raw);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : nowParts.year;
    if (year < 100) year += 2000;
    const hadTime = numeric[4] !== undefined;
    const hour = hadTime ? Number(numeric[4]) : DEFAULT_TIME.hour;
    const minute = hadTime ? Number(numeric[5]) : DEFAULT_TIME.minute;
    if (hour > 23 || minute > 59) return null;
    const candidate = buildDate(year, month, day, hour, minute, tz);
    if (!candidate) return null;
    if (!numeric[3] && candidate.getTime() < todayStart.getTime()) {
      const nextYear = buildDate(year + 1, month, day, hour, minute, tz);
      if (!nextYear) return null;
      return { date: nextYear, hadTime };
    }
    return { date: candidate, hadTime };
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(raw);
  if (iso) {
    const hadTime = iso[4] !== undefined;
    const date = buildDate(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      hadTime ? Number(iso[4]) : DEFAULT_TIME.hour,
      hadTime ? Number(iso[5]) : DEFAULT_TIME.minute,
      tz,
    );
    return date ? { date, hadTime } : null;
  }

  const words = /^(\d{1,2}) ([а-я]+)\.?(?: (\d{4}))?(?: (\d{1,2})[:.](\d{2}))?$/.exec(raw);
  if (words) {
    const month = MONTH_ALIASES[words[2] ?? ''];
    if (!month) return null;
    const day = Number(words[1]);
    const hadTime = words[4] !== undefined;
    const hour = hadTime ? Number(words[4]) : DEFAULT_TIME.hour;
    const minute = hadTime ? Number(words[5]) : DEFAULT_TIME.minute;
    let year = words[3] ? Number(words[3]) : nowParts.year;
    if (year < 100) year += 2000;
    const candidate = buildDate(year, month, day, hour, minute, tz);
    if (!candidate) return null;
    if (!words[3] && candidate.getTime() < todayStart.getTime()) {
      const nextYear = buildDate(year + 1, month, day, hour, minute, tz);
      if (!nextYear) return null;
      return { date: nextYear, hadTime };
    }
    return { date: candidate, hadTime };
  }

  const relative = /^(сегодня|завтра|послезавтра)(?: (\d{1,2})(?:[:.](\d{2}))?)?$/.exec(raw);
  if (relative) {
    const offset = relative[1] === 'сегодня' ? 0 : relative[1] === 'завтра' ? 1 : 2;
    const hadTime = relative[2] !== undefined;
    const hour = hadTime ? Number(relative[2]) : DEFAULT_TIME.hour;
    const minute = hadTime && relative[3] !== undefined ? Number(relative[3]) : 0;
    if (hour > 23 || minute > 59) return null;
    const base = new Date(todayStart.getTime() + offset * 86_400_000);
    const baseParts = tzParts(base, tz);
    const date = buildDate(baseParts.year, baseParts.month, baseParts.day, hour, minute, tz);
    return date ? { date, hadTime } : null;
  }

  const timeOnly = /^(\d{1,2})[:.](\d{2})$/.exec(raw);
  if (timeOnly) {
    const hour = Number(timeOnly[1]);
    const minute = Number(timeOnly[2]);
    if (hour > 23 || minute > 59) return null;
    const today = buildDate(nowParts.year, nowParts.month, nowParts.day, hour, minute, tz);
    if (!today) return null;
    if (today.getTime() <= now.getTime()) {
      const tomorrowBase = new Date(todayStart.getTime() + 86_400_000);
      const tomorrowParts = tzParts(tomorrowBase, tz);
      const tomorrow = buildDate(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, hour, minute, tz);
      return tomorrow ? { date: tomorrow, hadTime: true } : null;
    }
    return { date: today, hadTime: true };
  }

  return null;
};

/**
 * Разбирает лимит участников: «без ограничения» / «нет» / «-» → null,
 * число → число, всё остальное → undefined (некорректный ввод).
 */
export const parseLimit = (input: string): number | null | undefined => {
  const raw = normalizeInput(input);
  if (['нет', '-', 'без ограничения', 'без ограничений', 'не ограничено', '0'].includes(raw)) return null;
  const digits = /^(\d{1,4})$/.exec(raw);
  if (!digits) return undefined;
  const value = Number(digits[1]);
  return value > 0 ? value : null;
};

/**
 * Разбирает только время: «19:00», «в 11», «9.30», «19». Нужен шагу мастера, где
 * дата уже известна, а от пользователя ждут часы и минуты.
 */
export const parseUserTime = (input: string, options: ParseOptions = {}): { hour: number; minute: number } | null => {
  const tz = options.tz ?? 'Europe/Moscow';
  void tz;
  const raw = normalizeInput(input);
  if (!raw) return null;

  const match = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
};
