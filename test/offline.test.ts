import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { Logger } from '../src/logger.js';
import { createMemoryRepositories, MemoryStore } from '../src/db/memory/index.js';
import type { Db } from '../src/db/pool.js';
import { createRepositories } from '../src/db/repositories/index.js';
import { PgSessionStore } from '../src/db/sessions.js';
import { createStorage } from '../src/db/storage.js';
import { ConnectionMonitor, isConnectionError } from '../src/db/resilient/connectionMonitor.js';
import { createOfflineStateFile } from '../src/db/resilient/offlineFile.js';
import { createResilientRepositories } from '../src/db/resilient/resilientRepositories.js';
import { ResilientSessionStore } from '../src/db/resilient/sessions.js';
import { syncMemoryToDb } from '../src/db/resilient/sync.js';
import { startHarness, testConfig, type Harness } from './support.js';

/** Логгер-перехватчик: проверяем, что бот честно «ноет» про недоступную базу. */
const createCapturingLogger = (): { logger: Logger; lines: string[] } => {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug ${message}`),
    info: (message) => lines.push(`info ${message}`),
    warn: (message) => lines.push(`warn ${message}`),
    error: (message) => lines.push(`error ${message}`),
    child: () => logger,
  };
  return { logger, lines };
};

/** База, которая всегда недоступна: имитируем упавший PostgreSQL. */
const failingDb = (code = 'ECONNREFUSED'): Db => {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code });
  };
  return {
    query: fail,
    transaction: fail,
    ping: fail,
    close: async () => undefined,
    pool: {},
  } as unknown as Db;
};

describe('Работа без базы и синхронизация', () => {
  it('распознаёт ошибку соединения и не путает её с бизнес-ошибкой', () => {
    assert.equal(isConnectionError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true);
    assert.equal(isConnectionError(new Error('Connection terminated unexpectedly')), true);
    assert.equal(isConnectionError(Object.assign(new Error('duplicate key'), { code: '23505' })), false);
    assert.equal(isConnectionError(new Error('Ответ не подходит под ограничения')), false);
  });

  it('при недоступной базе обслуживает запросы из памяти и пишет об этом в лог', async () => {
    const { logger, lines } = createCapturingLogger();
    const store = new MemoryStore();
    const db = failingDb();
    const monitor = new ConnectionMonitor(db, logger, {});
    const resilient = createResilientRepositories({
      pg: createRepositories(db),
      memory: createMemoryRepositories(store),
      store,
      monitor,
      logger,
    });

    const event = await resilient.repositories.events.create({
      title: 'Настолки',
      description: '',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      place: 'кафе',
      placeCoords: null,
      limit: 4,
      fields: [],
      organizerId: 1,
      organizerName: 'Оля',
    });
    assert.ok(event.id);
    assert.equal(monitor.isOnline(), false);
    assert.ok(
      lines.some((line) => line.startsWith('error') && /Нет связи с PostgreSQL/.test(line)),
      `в логе нет сообщения об обрыве: ${lines.join(' | ')}`,
    );
    assert.ok(
      lines.some((line) => /выполняю в памяти/.test(line)),
      'в логе нет отметки о переходе на память',
    );

    // Дальше работаем без базы: список покупок и брони живут в памяти.
    const items = await resilient.repositories.items.addMany(event.id, ['Продукты', 'Вода']);
    assert.equal(items.length, 2);
    const first = await resilient.repositories.items.reserve(items[0]!.id, event.id, 7, 'Аня');
    assert.ok(first.reserved, 'первая бронь не прошла');
    const second = await resilient.repositories.items.reserve(items[0]!.id, event.id, 8, 'Боря');
    assert.equal(second.reserved, null);
    assert.equal(second.takenBy, 'Аня');

    const participants = await resilient.repositories.participants.listByEvent(event.id);
    assert.deepEqual(participants, []);

    const stats = resilient.stats();
    assert.equal(stats.mode, 'memory');
    assert.ok(stats.fallbacks >= 1);
    assert.equal(stats.counts.events, 1);
    assert.equal(stats.counts.items, 2);
  });

  it('в режиме memory работает вообще без базы', async () => {
    const { logger } = createCapturingLogger();
    const storage = await createStorage(
      testConfig({
        storageMode: 'memory',
        // Порт, на котором заведомо ничего нет: если режим memory сломается, тест упадёт.
        databaseUrl: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
        offlineStatePath: '',
      }),
      logger,
    );
    try {
      const event = await storage.repositories.events.create({
        title: 'Отладка',
        description: '',
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        place: 'кафе',
        placeCoords: null,
        limit: null,
        fields: [],
        organizerId: 5,
        organizerName: 'Оля',
      });
      const found = await storage.repositories.events.findByCode(event.code);
      assert.equal(found?.id, event.id);
      assert.equal(storage.monitor.isOnline(), false);
      assert.equal(storage.stats().mode, 'memory');
    } finally {
      await storage.stop();
    }
  });
});

describe('Синхронизация памяти с PostgreSQL', () => {
  let harness: Harness;

  before(async () => {
    harness = await startHarness();
  });

  after(async () => {
    await harness.stop();
  });

  it('переносит созданное без базы в PostgreSQL с теми же идентификаторами', async () => {
    const { logger } = createCapturingLogger();
    const store = new MemoryStore();
    const memory = createMemoryRepositories(store);

    const event = await memory.events.create({
      title: 'Настолки в пятницу',
      description: 'из памяти',
      startsAt: new Date(Date.now() + 7_200_000).toISOString(),
      place: 'антикафе Кубик',
      placeCoords: { lat: 55.75, lon: 37.61 },
      limit: 4,
      fields: [],
      organizerId: 42,
      organizerName: 'Оля',
    });
    await memory.participants.upsert({
      eventId: event.id,
      userId: 7,
      name: 'Аня',
      username: 'anya',
      contact: '+7 900 000-00-01',
      status: 'going',
      answers: {},
      waitlisted: false,
    });
    const items = await memory.items.addMany(event.id, ['Продукты', 'Вода']);
    await memory.items.reserve(items[0]!.id, event.id, 7, 'Аня');
    await memory.items.setPaidAmount(items[0]!.id, 7, 120_050);
    await memory.users.ensure(7, { name: 'Аня', username: 'anya' });
    await memory.templates.create(42, 'Настолки', []);

    await syncMemoryToDb(harness.db, store, logger);

    // Данные в базе: те же id, бронь и сумма на месте.
    const fromDb = await harness.events.findByCode(event.code);
    assert.equal(fromDb?.id, event.id);
    assert.equal(fromDb?.placeCoords?.lat, 55.75);

    const participant = await harness.participants.find(event.id, 7);
    assert.equal(participant?.name, 'Аня');

    const dbItems = await harness.items.list(event.id);
    assert.equal(dbItems.length, 2);
    assert.equal(dbItems[0]?.reservation?.userId, 7);
    assert.equal(dbItems[0]?.reservation?.paidKopecks, 120_050);

    const templates = await harness.repos.templates.listByOwner(42);
    assert.equal(templates.length, 1);

    // Повторная синхронизация идемпотентна: дублей не появляется.
    await syncMemoryToDb(harness.db, store, logger);
    const again = await harness.items.list(event.id);
    assert.equal(again.length, 2);
    const participants = await harness.participants.listByEvent(event.id);
    assert.equal(participants.length, 1);
  });

  it('переносит черновики мастеров, созданные в памяти', async () => {
    const { logger } = createCapturingLogger();
    const db = failingDb();
    const monitor = new ConnectionMonitor(db, logger, {});
    const sessions = new ResilientSessionStore<{ draft?: string }>(
      new PgSessionStore<{ draft?: string }>(harness.db, 3_600_000),
      monitor,
      logger,
      3_600_000,
    );

    await sessions.set('99:99', { draft: 'шаг 2' });
    assert.deepEqual(await sessions.get('99:99'), { draft: 'шаг 2' });

    // Связь появилась: черновик уезжает в базу и остаётся доступным.
    monitor.markOffline(new Error('connect ECONNREFUSED'));
    const moved = await sessions.flushToPg();
    assert.equal(moved, 1);
    const stored = await sessions.get('99:99');
    assert.deepEqual(stored, { draft: 'шаг 2' });
  });
});

describe('Снимок памяти на диске', () => {
  it('сохраняет и поднимает данные после перезапуска без базы', () => {
    const { logger } = createCapturingLogger();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dosug-offline-'));
    const file = createOfflineStateFile(path.join(dir, 'offline.json'), logger);

    try {
      const store = new MemoryStore();
      store.putEvent({
        id: 'evt_1',
        code: 'ABC12',
        title: 'Настолки',
        description: '',
        startsAt: new Date().toISOString(),
        place: 'кафе',
        placeCoords: null,
        limit: null,
        fields: [],
        answerMode: 'auto',
        status: 'published',
        organizerId: 1,
        organizerName: 'Оля',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedAt: null,
      });
      file.save(store.snapshot());
      assert.equal(file.exists(), true);

      const restored = new MemoryStore();
      restored.restore(file.load()!);
      assert.equal(restored.counts().events, 1);
      assert.equal(restored.eventByCode('ABC12')?.id, 'evt_1');

      file.clear();
      assert.equal(file.exists(), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
