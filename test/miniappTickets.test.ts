import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BotSession } from '../src/bot/session.js';
import { createMiniappTicketStore, TICKET_TTL_MS, ticketKey } from '../src/bot/miniappTickets.js';
import { PgSessionStore } from '../src/db/sessions.js';
import type { SessionsStore } from '../src/db/storage.js';
import { startHarness, type Harness } from './support.js';
import { ticketFor } from './tickets.js';
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
    await before.register('abc123', ticketFor(42));

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

  it('пропуск без чата или сессии мастера недействителен', async () => {
    // Такие записи остались от версии, где черновик искали «первый подходящий
    // у пользователя»: пропуск без адреса и сессии не должен пускать в мастер.
    const sessions = memorySessions();
    const store = createMiniappTicketStore(sessions);
    await sessions.set(ticketKey('legacy-1'), { userId: 5, at: Date.now(), sessionKey: '5:5' });
    await sessions.set(ticketKey('legacy-2'), { userId: 5, at: Date.now(), chatId: 5 });
    assert.equal(await store.take('legacy-1'), null);
    assert.equal(await store.take('legacy-2'), null);

    await store.register('good', ticketFor(5));
    assert.equal((await store.take('good'))?.chatId, 5);
  });

  it('просроченная подпись не работает и удаляется', async () => {
    const sessions = memorySessions();
    const store = createMiniappTicketStore(sessions, 1000);
    await store.register('old', ticketFor(7, { at: Date.now() - 5000 }));
    assert.equal(await store.take('old'), null);
    // Запись вычищена, повторное обращение тоже пустое.
    assert.equal(await store.take('old'), null);
  });

  it('подпись живёт ограниченное время, но не пропадает сразу', async () => {
    const store = createMiniappTicketStore(memorySessions());
    await store.register('fresh', ticketFor(8));
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
    await first.register('ticket-1', ticketFor(99));

    // Другой экземпляр поверх той же базы — эмуляция нового процесса.
    const second = createMiniappTicketStore(
      new PgSessionStore<BotSession>(harness.db, 3_600_000) as unknown as SessionsStore<object>,
    );
    assert.equal((await second.take('ticket-1'))?.userId, 99);
  });
});
