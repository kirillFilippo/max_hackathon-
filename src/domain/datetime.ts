/**
 * Разбор и форматирование дат в заданном часовом поясе без внешних зависимостей.
 * Организатор вводит дату «по-человечески» («завтра 19:00», «25.10 18:30»),
 * а храним мы всегда UTC ISO-строку.
 */

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const MONTH_ALIASES: Record<string, number> = {
  янв: 1, январь: 1, января: 1,
  фев: 2, февраль: 2, февраля: 2,
  мар: 3, март: 3, марта: 3,
  апр: 4, апрель: 4, апреля: 4,
  май: 5, мая: 5,
  июн: 6, июнь: 6, июня: 6,
  июл: 7, июль: 7, июля: 7,
  авг: 8, август: 8, августа: 8,
  сен: 9, сент: 9, сентябрь: 9, сентября: 9,
  окт: 10, октябрь: 10, октября: 10,
  ноя: 11, ноябрь: 11, ноября: 11,
  дек: 12, декабрь: 12, декабря: 12,
};

export const DEFAULT_TIME = { hour: 19, minute: 0 };

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (tz: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, formatter);
  }
  return formatter;
};

export const tzParts = (date: Date, tz: string): ZonedParts => {
  const parts = formatterFor(tz).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? '0';
    return Number(value);
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
};

/** Смещение пояса в миллисекундах для конкретного момента (учитывает переход на летнее время). */
export const tzOffsetMs = (date: Date, tz: string): number => {
  const parts = tzParts(date, tz);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** Переводит «настенное» время в поясе tz в UTC-момент. */
export const zonedToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date => {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = tzOffsetMs(new Date(guess), tz);
  const firstTry = guess - firstOffset;
  const secondOffset = tzOffsetMs(new Date(firstTry), tz);
  return new Date(guess - secondOffset);
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const weekdayIndex = (date: Date, tz: string): number => {
  const parts = tzParts(date, tz);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
};

/** «25 октября 2025, сб, 19:00» */
export const formatDateTime = (value: string | Date, tz: string): string => {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const parts = tzParts(date, tz);
  const month = MONTHS_GENITIVE[parts.month - 1] ?? '';
  const weekday = WEEKDAYS_SHORT[weekdayIndex(date, tz)] ?? '';
  return `${parts.day} ${month} ${parts.year}, ${weekday}, ${pad(parts.hour)}:${pad(parts.minute)}`;
};

/** «25.10, 19:00» */
export const formatDateTimeShort = (value: string | Date, tz: string): string => {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const parts = tzParts(date, tz);
  return `${pad(parts.day)}.${pad(parts.month)}, ${pad(parts.hour)}:${pad(parts.minute)}`;
};

/** Русские формы множественного числа: plural(2, ['час', 'часа', 'часов']) → 'часа'. */
export const plural = (count: number, forms: [string, string, string]): string => {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
};

/** Совпадают ли календарные даты (в поясе tz) через один день. */
const isNextCalendarDay = (from: Date, to: Date, tz: string): boolean => {
  const a = tzParts(from, tz);
  const b = tzParts(to, tz);
  const fromDay = Date.UTC(a.year, a.month - 1, a.day);
  const toDay = Date.UTC(b.year, b.month - 1, b.day);
  return toDay - fromDay === 86_400_000;
};

/**
 * «через 2 дня», «через 5 часов», «меньше часа», «уже началось».
 * Если передан пояс, для следующего календарного дня говорим «завтра».
 */
export const formatRelative = (from: Date, to: Date, tz?: string): string => {
  const diffMs = to.getTime() - from.getTime();
  if (diffMs <= 0) return 'уже началось';

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `через ${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}`;
  }

  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) {
    return `через ${hours} ${plural(hours, ['час', 'часа', 'часов'])}`;
  }

  if (tz && isNextCalendarDay(from, to, tz)) return 'завтра';

  const days = Math.round(diffMs / 86_400_000);
  return `через ${days} ${plural(days, ['день', 'дня', 'дней'])}`;
};

export interface ParsedDateTime {
  date: Date;
  /** false, если время не указано и подставлено DEFAULT_TIME. */
  hadTime: boolean;
}

export interface ParseOptions {
  now?: Date;
  tz?: string;
}

const normalizeInput = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ');

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

  const relative = /^(сегодня|завтра|послезавтра)(?: (\d{1,2})[:.](\d{2}))?$/.exec(raw);
  if (relative) {
    const offset = relative[1] === 'сегодня' ? 0 : relative[1] === 'завтра' ? 1 : 2;
    const hadTime = relative[2] !== undefined;
    const hour = hadTime ? Number(relative[2]) : DEFAULT_TIME.hour;
    const minute = hadTime ? Number(relative[3]) : DEFAULT_TIME.minute;
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
