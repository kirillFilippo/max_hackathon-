/**
 * Форматирование дат в часовом поясе организатора: «25 октября 2026, сб, 19:00»,
 * «через 2 дня», склонение слов. Работает через Intl, без внешних зависимостей.
 */
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export const MONTH_ALIASES: Record<string, number> = {
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
