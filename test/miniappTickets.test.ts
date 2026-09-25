import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BotSession } from '../src/bot/session.js';
import { createMiniappTicketStore, TICKET_TTL_MS } from '../src/bot/miniappTickets.js';
import { PgSessionStore } from '../src/db/sessions.js';
import type { SessionsStore } from '../src/db/storage.js';
import { startHarness, type Harness } from './support.js';
import { after, before } from 'node:test';

/** Хранилище сессий в памяти: проверяем саму логику пропусков, без базы. */
const memorySessions = (): SessionsStore<object> => {
  const rows = new Map<string, { value: object; expiresAt: number }>();
  return {
    async get(key) {
      const row = rows.get(key);
      if (!row || row.expiresAt <= Date.now()) return undefined;
      return row.value;
    },
    async set(key, value) {
      rows.set(key, { value, expiresAt: Date.now() + 24 * 3_600_000 });
    },
    async delete(key) {
      rows.delete(key);
    },
    async findByUser() {
      return [];
    },
    async cleanupExpired() {
      return 0;
    },
  };
};

describe('Подписи конструктора мини-приложения', () => {
  it('выданная подпись работает и после перезапуска бота', async () => {
    const sessions = memorySessions();
    const before = createMiniappTicketStore(sessions);
    await before.register('abc123', { userId: 42, at: Date.now() });

    // Новый процесс поверх того же хранилища — как после деплоя.
    const restarted = createMiniappTicketStore(sessions);
    const ticket = await restarted.take('abc123');
    assert.equal(ticket?.userId, 42, 'подпись не пережила перезапуск');
    // Подпись многоразовая: повторное сохранение из конструктора тоже проходит.
    assert.equal((await restarted.take('abc123'))?.userId, 42);
  });

  it('неизвестная подпись не пускает в черновик', async () => {
    const store = createMiniappTicketStore(memorySessions());
    assert.equal(await store.take('нет-такой'), null);
    assert.equal(await store.take(''), null);
  });

  it('просроченная подпись не работает и удаляется', async () => {
    const sessions = memorySessions();
    const store = createMiniappTicketStore(sessions, 1000);
    await store.register('old', { userId: 7, at: Date.now() - 5000 });
    assert.equal(await store.take('old'), null);
    // Запись вычищена, повторное обращение тоже пустое.
    assert.equal(await store.take('old'), null);
  });

  it('подпись живёт ограниченное время, но не пропадает сразу', async () => {
    const store = createMiniappTicketStore(memorySessions());
    await store.register('fresh', { userId: 8, at: Date.now() });
    assert.equal((await store.take('fresh'))?.userId, 8);
    assert.ok(TICKET_TTL_MS >= 5 * 60 * 1000, 'слишком короткий срок жизни подписи');
  });
});

describe('Подписи конструктора в PostgreSQL', () => {
  let harness: Harness;

  before(async () => {
    harness = await startHarness();
  });

  after(async () => {
    await harness.stop();
  });

  it('переживают перезапуск процесса: подпись читается новым экземпляром', async () => {
    const sessions = new PgSessionStore<BotSession>(harness.db, 3_600_000);
    const first = createMiniappTicketStore(sessions as unknown as SessionsStore<object>);
    await first.register('ticket-1', { userId: 99, at: Date.now() });

    // Другой экземпляр поверх той же базы — эмуляция нового процесса.
    const second = createMiniappTicketStore(
      new PgSessionStore<BotSession>(harness.db, 3_600_000) as unknown as SessionsStore<object>,
    );
    assert.equal((await second.take('ticket-1'))?.userId, 99);
  });
});
