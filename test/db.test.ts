import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startHarness, createEvent, register, hoursFromNow, type Harness } from './support.js';

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.stop();
});

describe('События и участники', () => {
  it('создаёт событие, находит по коду и строит ссылку-приглашение', async () => {
    const event = await createEvent(harness, { limit: 8 });

    assert.match(event.code, /^[A-Z0-9]{5}$/);
    assert.equal(event.status, 'published');
    assert.equal(event.limit, 8);
    assert.equal(harness.events.inviteLink(event, 'DosugTestBot'), `https://max.ru/DosugTestBot?start=ev_${event.code}`);

    const byCode = await harness.events.findByCode(event.code.toLowerCase());
    assert.equal(byCode?.id, event.id);
  });

  it('сохраняет координаты адреса и обновляет событие со списком изменений', async () => {
    const event = await createEvent(harness, {
      place: 'Точка сбора',
      placeCoords: { lat: 55.75, lon: 37.61 },
    });
    assert.deepEqual((await harness.events.findById(event.id))?.placeCoords, { lat: 55.75, lon: 37.61 });

    const { changes } = await harness.events.update(event.id, {
      place: 'Новое место, ул. Мира 1',
      limit: 6,
    });
    assert.equal(changes.length, 2);
    assert.ok(changes.some((change) => change.includes('место')));
  });

  it('закрывает события, начавшиеся больше трёх часов назад', async () => {
    const stale = await createEvent(harness, { startsAt: hoursFromNow(-5) });
    const future = await createEvent(harness, { startsAt: hoursFromNow(2) });

    const closed = await harness.events.closeExpired(new Date());

    assert.ok(closed.some((event) => event.code === stale.code));
    assert.equal((await harness.events.findById(stale.id))?.status, 'closed');
    assert.equal((await harness.events.findById(future.id))?.status, 'published');
  });

  it('ставит в лист ожидания при превышении лимита и поднимает при отказе', async () => {
    const event = await createEvent(harness, { limit: 1 });

    const anya = await register(harness, event.id, 1, 'Аня', 'going');
    assert.equal(anya.waitlisted, false);

    const boris = await register(harness, event.id, 2, 'Боря', 'going');
    assert.equal(boris.waitlisted, true);
    assert.equal(boris.limitReached, true);

    const fresh = await harness.events.findById(event.id);
    const result = await harness.participants.setStatus(fresh!, 1, 'not_going');

    assert.ok(result);
    assert.equal(result.promoted?.userId, 2);
    assert.equal(result.promoted?.status, 'going');
    assert.equal(result.promoted?.waitlisted, false);
  });

  it('обновляет существующую заявку вместо создания второй', async () => {
    const event = await createEvent(harness);
    await register(harness, event.id, 1, 'Аня', 'going');
    const again = await register(harness, event.id, 1, 'Аня', 'maybe');

    assert.equal(again.participant.status, 'maybe');
    const list = await harness.participants.listByEvent(event.id);
    assert.equal(list.length, 1);
  });
});

describe('Список покупок и брони', () => {
  /**
   * Сценарий из требований: список 1–5, участники называют наборы номеров,
   * каждая позиция достаётся ровно одному человеку, остальным бот сообщает,
   * что занято и что осталось.
   */
  it('резервирует позиции по принципу «кто первый» и показывает остаток', async () => {
    const event = await createEvent(harness);
    await harness.items.add(event.id, ['1 Снеки', '2 Вода', '3 Уголь', '4 Мясо', '5 Хлеб']);
    await register(harness, event.id, 1, 'Аня');
    await register(harness, event.id, 2, 'Боря');
    await register(harness, event.id, 3, 'Вика');
    await register(harness, event.id, 4, 'Дима');

    const first = await harness.items.reserveByNumbers(event, 1, 'Аня', [1, 2, 3]);
    assert.deepEqual(first.reserved.map((item) => item.position), [1, 2, 3]);
    assert.deepEqual(first.taken, []);

    const second = await harness.items.reserveByNumbers(event, 2, 'Боря', [1, 2, 4]);
    assert.deepEqual(second.reserved.map((item) => item.position), [4]);
    assert.deepEqual(second.taken.map((entry) => entry.item.position), [1, 2]);
    assert.deepEqual(second.taken.map((entry) => entry.byName), ['Аня', 'Аня']);

    const third = await harness.items.reserveByNumbers(event, 3, 'Вика', [1, 2]);
    assert.deepEqual(third.reserved, []);
    assert.equal(third.taken.length, 2);
    assert.deepEqual(third.free.map((item) => item.position), [5]);

    const fourth = await harness.items.reserveByNumbers(event, 4, 'Дима', [1]);
    assert.deepEqual(fourth.reserved, []);
    assert.equal(fourth.taken[0]?.byName, 'Аня');
    assert.deepEqual(fourth.free.map((item) => item.position), [5]);

    const all = await harness.items.list(event.id);
    assert.deepEqual(
      all.map((item) => [item.position, item.reservation?.userName ?? null]),
      [
        [1, 'Аня'],
        [2, 'Аня'],
        [3, 'Аня'],
        [4, 'Боря'],
        [5, null],
      ],
    );
  });

  it('не создаёт две брони на одну позицию при параллельных нажатиях', async () => {
    const event = await createEvent(harness);
    await harness.items.add(event.id, ['Палатка']);
    const items = await harness.items.list(event.id);
    const itemId = items[0]!.id;

    const [first, second] = await Promise.all([
      harness.items.reserveItem(event, itemId, 1, 'Аня'),
      harness.items.reserveItem(event, itemId, 2, 'Боря'),
    ]);

    const successCount = [first, second].filter((result) => result.reserved).length;
    assert.equal(successCount, 1);
  });

  it('освобождает позиции, когда участник отказывается от события', async () => {
    const event = await createEvent(harness);
    await harness.items.add(event.id, ['Продукты', 'Вода']);
    await register(harness, event.id, 2, 'Боря');
    await harness.items.reserveByNumbers(event, 2, 'Боря', [1, 2]);

    const fresh = await harness.events.findById(event.id);
    const result = await harness.participants.setStatus(fresh!, 2, 'not_going');

    assert.deepEqual(result?.releasedItems.map((item) => item.title), ['Продукты', 'Вода']);
    const all = await harness.items.list(event.id);
    assert.ok(all.every((item) => item.reservation === null));
  });

  it('даёт участнику отказаться от одной позиции и удалять позиции организатору', async () => {
    const event = await createEvent(harness);
    await harness.items.add(event.id, ['Продукты', 'Вода']);
    await register(harness, event.id, 2, 'Боря');
    await harness.items.reserveByNumbers(event, 2, 'Боря', [1, 2]);

    const items = await harness.items.list(event.id);
    assert.equal(await harness.items.release(items[0]!.id, 2), true);
    const afterRelease = await harness.items.list(event.id);
    assert.equal(afterRelease[0]?.reservation, null);
    assert.equal(afterRelease[1]?.reservation?.userName, 'Боря');

    assert.equal(await harness.items.removeItem(afterRelease[1]!.id), true);
    assert.equal((await harness.items.list(event.id)).length, 1);
  });
});

describe('Сессии в базе', () => {
  it('сохраняет черновик между экземплярами хранилища', async () => {
    await harness.sessionStore.set('1:1', { lastEventCode: 'ABC12', draft: null });
    const reloaded = new (await import('../src/db/sessions.js')).PgSessionStore<{
      lastEventCode?: string | null;
    }>(harness.db, 60_000);

    assert.equal((await reloaded.get('1:1'))?.lastEventCode, 'ABC12');
    await reloaded.delete('1:1');
    assert.equal(await reloaded.get('1:1'), undefined);
  });
});
