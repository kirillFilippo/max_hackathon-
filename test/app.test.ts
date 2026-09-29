import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { hoursFromNow, testConfig } from './support.js';

/**
 * Сборка приложения: композиционный корень до сих пор не был покрыт тестами,
 * а именно здесь ломается «всё сразу», если перепутать зависимости.
 *
 * Хранилище берём в режиме памяти (база не нужна), мини-приложение — на случайном
 * порту; в MAX не ходим, поэтому `start()` здесь не вызывается.
 */
const buildApp = (overrides: Parameters<typeof testConfig>[0] = {}) =>
  createApp(
    testConfig({
      storageMode: 'memory',
      offlineStatePath: '',
      databaseUrl: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
      ...overrides,
    }),
    createLogger('error'),
  );

describe('Сборка приложения', () => {
  it('собирает зависимости без базы и без мини-приложения', async () => {
    const app = await buildApp({ miniappUrl: undefined });
    try {
      assert.ok(app.deps.events, 'нет сервиса событий');
      assert.ok(app.deps.debug, 'нет отладочного сервиса');
      assert.ok(app.deps.repos.events, 'нет хранилища');
      assert.equal(app.deps.miniapp, null, 'мини-приложение включилось без адреса');

      // Композиция рабочая: событие создаётся через собранные зависимости.
      const event = await app.deps.events.create({
        title: 'Проверка сборки',
        description: '',
        startsAt: hoursFromNow(24),
        place: 'кафе',
        placeCoords: null,
        limit: null,
        fields: [],
        organizerId: 1,
        organizerName: 'Оля',
      });
      assert.ok(event.code.length >= 4);
      assert.equal((await app.deps.repos.events.findByCode(event.code))?.id, event.id);
    } finally {
      await app.stop();
    }
  });

  it('поднимает мини-приложение и связывает его с ботом', async () => {
    const app = await buildApp({ miniappUrl: 'https://example.test', miniappPort: 0 });
    try {
      const bridge = app.deps.miniapp;
      assert.ok(bridge, 'мост мини-приложения не собран');

      // Ссылка конструктора строится по подписи и ведёт на страницу вопросов.
      await bridge.registerTicket('ticket-1', {
        userId: 7,
        chatId: 42,
        sessionKey: '7:42',
        at: Date.now(),
      });
      const url = bridge.buildUrl('ticket-1');
      assert.match(url, /^https:\/\/example\.test\/app\/questions\?t=ticket-1$/);

      // Подпись выдана ботом и проверяется тем же хранилищем сессий.
      const owner = await bridge.takeTicket('ticket-1');
      assert.equal(owner?.userId, 7);
      // Ключ сессии и чат едут вместе с подписью: по сессии конструктор находит
      // свой черновик, а по чату бот возвращает обновлённый экран.
      assert.equal(owner?.sessionKey, '7:42');
      assert.equal(owner?.chatId, 42);
      assert.equal(await bridge.takeTicket('нет-такой'), null);
    } finally {
      await app.stop();
    }
  });
});
