import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_TIME,
  formatDateTime,
  formatRelative,
  parseLimit,
  parseUserDateTime,
  plural,
  tzParts,
  zonedToUtc,
} from '../src/domain/datetime.js';

const TZ = 'Europe/Moscow';
const NOW = new Date('2025-10-20T10:00:00.000Z'); // 13:00 по Москве

describe('parseUserDateTime', () => {
  it('понимает «завтра 19:00»', () => {
    const parsed = parseUserDateTime('завтра 19:00', { now: NOW, tz: TZ });
    assert.ok(parsed);
    assert.equal(parsed.hadTime, true);
    // 21 октября 19:00 MSK = 16:00 UTC
    assert.equal(parsed.date.toISOString(), '2025-10-21T16:00:00.000Z');
  });

  it('понимает «сегодня 20:30» и «послезавтра»', () => {
    assert.equal(
      parseUserDateTime('сегодня 20:30', { now: NOW, tz: TZ })?.date.toISOString(),
      '2025-10-20T17:30:00.000Z',
    );
    const afterTomorrow = parseUserDateTime('послезавтра', { now: NOW, tz: TZ });
    assert.ok(afterTomorrow);
    assert.equal(afterTomorrow.hadTime, false);
    assert.equal(afterTomorrow.date.toISOString(), '2025-10-22T16:00:00.000Z');
  });

  it('понимает числовые форматы', () => {
    assert.equal(
      parseUserDateTime('25.10 18:30', { now: NOW, tz: TZ })?.date.toISOString(),
      '2025-10-25T15:30:00.000Z',
    );
    assert.equal(
      parseUserDateTime('25/10/2026 18:30', { now: NOW, tz: TZ })?.date.toISOString(),
      '2026-10-25T15:30:00.000Z',
    );
    assert.equal(
      parseUserDateTime('2025-12-31 23:30', { now: NOW, tz: TZ })?.date.toISOString(),
      '2025-12-31T20:30:00.000Z',
    );
  });

  it('понимает месяцы словами', () => {
    assert.equal(
      parseUserDateTime('25 октября 19:00', { now: NOW, tz: TZ })?.date.toISOString(),
      '2025-10-25T16:00:00.000Z',
    );
    assert.equal(
      parseUserDateTime('1 января 2027 12:00', { now: NOW, tz: TZ })?.date.toISOString(),
      '2027-01-01T09:00:00.000Z',
    );
  });

  it('переносит дату на следующий год, если она уже прошла', () => {
    assert.equal(
      parseUserDateTime('01.01 12:00', { now: NOW, tz: TZ })?.date.toISOString(),
      '2026-01-01T09:00:00.000Z',
    );
  });

  it('время без даты: сегодня, а если прошло — завтра', () => {
    const future = parseUserDateTime('19:00', { now: NOW, tz: TZ });
    assert.equal(future?.date.toISOString(), '2025-10-20T16:00:00.000Z');
    const past = parseUserDateTime('09:00', { now: NOW, tz: TZ });
    assert.equal(past?.date.toISOString(), '2025-10-21T06:00:00.000Z');
  });

  it('подставляет время по умолчанию, если его не указали', () => {
    const parsed = parseUserDateTime('25.10', { now: NOW, tz: TZ });
    assert.ok(parsed);
    assert.equal(parsed.hadTime, false);
    const parts = tzParts(parsed.date, TZ);
    assert.equal(parts.hour, DEFAULT_TIME.hour);
    assert.equal(parts.minute, DEFAULT_TIME.minute);
  });

  it('игнорирует «ё», лишние пробелы и предлог «в»', () => {
    assert.equal(
      parseUserDateTime('  в   25  октября   19:00 ', { now: NOW, tz: TZ })?.date.toISOString(),
      '2025-10-25T16:00:00.000Z',
    );
  });

  it('возвращает null на мусор и несуществующие даты', () => {
    assert.equal(parseUserDateTime('скоро', { now: NOW, tz: TZ }), null);
    assert.equal(parseUserDateTime('', { now: NOW, tz: TZ }), null);
    assert.equal(parseUserDateTime('31.02 19:00', { now: NOW, tz: TZ }), null);
    assert.equal(parseUserDateTime('25:00', { now: NOW, tz: TZ }), null);
  });

  it('считает время в разных часовых поясах', () => {
    const moscow = parseUserDateTime('25.10 12:00', { now: NOW, tz: 'Europe/Moscow' });
    const kaliningrad = parseUserDateTime('25.10 12:00', { now: NOW, tz: 'Europe/Kaliningrad' });
    assert.ok(moscow && kaliningrad);
    assert.equal(moscow.date.toISOString(), '2025-10-25T09:00:00.000Z');
    assert.equal(kaliningrad.date.toISOString(), '2025-10-25T10:00:00.000Z');
  });
});

describe('parseLimit', () => {
  it('распознаёт «нет ограничения»', () => {
    assert.equal(parseLimit('нет'), null);
    assert.equal(parseLimit('без ограничения'), null);
    assert.equal(parseLimit('-'), null);
    assert.equal(parseLimit('0'), null);
  });

  it('распознаёт числа', () => {
    assert.equal(parseLimit('8'), 8);
    assert.equal(parseLimit(' 12 '), 12);
  });

  it('возвращает undefined на непонятный ввод', () => {
    assert.equal(parseLimit('много'), undefined);
    assert.equal(parseLimit('8 человек'), undefined);
  });
});

describe('форматирование', () => {
  it('formatDateTime показывает дату, день недели и время в нужном поясе', () => {
    const formatted = formatDateTime('2025-10-25T16:00:00.000Z', TZ);
    assert.match(formatted, /25 октября 2025/);
    assert.match(formatted, /сб/);
    assert.match(formatted, /19:00/);
  });

  it('formatRelative говорит по-человечески', () => {
    const from = new Date('2025-10-20T10:00:00.000Z');
    assert.equal(formatRelative(from, new Date('2025-10-20T10:30:00.000Z')), 'через 30 минут');
    assert.equal(formatRelative(from, new Date('2025-10-20T13:00:00.000Z')), 'через 3 часа');
    assert.equal(formatRelative(from, new Date('2025-10-21T13:00:00.000Z')), 'через 1 день');
    assert.equal(formatRelative(from, new Date('2025-10-22T13:00:00.000Z')), 'через 2 дня');
    assert.equal(formatRelative(from, new Date('2025-10-20T09:00:00.000Z')), 'уже началось');
  });

  it('formatRelative говорит «завтра» только для следующего календарного дня', () => {
    const from = new Date('2025-10-20T10:00:00.000Z'); // 13:00 МСК
    // 21 октября 19:00 МСК — следующий календарный день
    assert.equal(formatRelative(from, new Date('2025-10-21T16:00:00.000Z'), TZ), 'завтра');
    // 21 октября 23:00 МСК — тоже завтра, хотя это больше 24 часов? нет: 34 часа
    assert.equal(formatRelative(from, new Date('2025-10-22T20:00:00.000Z'), TZ), 'через 2 дня');
  });

  it('plural склоняет слова', () => {
    assert.equal(plural(1, ['час', 'часа', 'часов']), 'час');
    assert.equal(plural(3, ['час', 'часа', 'часов']), 'часа');
    assert.equal(plural(11, ['час', 'часа', 'часов']), 'часов');
    assert.equal(plural(22, ['час', 'часа', 'часов']), 'часа');
  });

  it('zonedToUtc и tzParts взаимно согласованы', () => {
    const date = zonedToUtc(2025, 10, 25, 19, 0, TZ);
    const parts = tzParts(date, TZ);
    assert.deepEqual(
      { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute },
      { year: 2025, month: 10, day: 25, hour: 19, minute: 0 },
    );
  });
});
