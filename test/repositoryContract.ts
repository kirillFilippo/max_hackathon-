import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { Repositories, SaveParticipantInput } from '../src/db/repositories/contracts.js';
import type { EventField, ParticipantStatus } from '../src/domain/types.js';

/**
 * Общий контракт хранилища: одна сюита гоняется и против PostgreSQL, и против
 * памяти (см. `repositoryContract.test.ts`).
 *
 * Зачем: реализации две, и расхождение между ними — самый неприятный класс ошибок.
 * Оно не видно ни в обычных тестах, ни в работе, и проявляется ровно тогда, когда
 * пропала связь с базой, то есть в худший момент. Раньше семантику проверяли двумя
 * наборами тестов, которые расходились между собой; теперь она одна.
 */

const field = (overrides: Partial<EventField> = {}): EventField => ({
  id: 'fld_size',
  label: 'Размер',
  type: 'choice',
  options: ['S', 'M'],
  multiple: false,
  minSelected: null,
  maxSelected: null,
  min: null,
  max: null,
  maxLength: null,
  required: true,
  ...overrides,
});

const eventInput = (organizerId = 1): Parameters<Repositories['events']['create']>[0] => ({
  title: 'Пикник',
  description: 'Поездка на природу',
  startsAt: '2030-06-01T10:00:00.000Z',
  place: 'Парк',
  placeCoords: null,
  limit: null,
  fields: [field()],
  organizerId,
  organizerName: 'Аня',
});

const participantInput = (
  eventId: string,
  userId: number,
  overrides: Partial<SaveParticipantInput> = {},
): SaveParticipantInput => ({
  eventId,
  userId,
  name: `Участник ${userId}`,
  username: null,
  contact: '',
  status: 'going' as ParticipantStatus,
  answers: {},
  waitlisted: false,
  ...overrides,
});

export const describeRepositoryContract = (
  implementation: string,
  getRepos: () => Promise<Repositories>,
): void => {
  describe(`контракт репозиториев: ${implementation}`, () => {
    let repos: Repositories;

    beforeEach(async () => {
      repos = await getRepos();
    });

    it('событие: поиск по коду и id, частичное обновление', async () => {
      const event = await repos.events.create(eventInput());
      assert.equal((await repos.events.findById(event.id))?.id, event.id);
      assert.equal((await repos.events.findByCode(event.code))?.id, event.id);
      assert.equal(await repos.events.findByCode('НЕТТАКОГО'), null);

      // Обновление меняет только переданные поля.
      const updated = await repos.events.update(event.id, { title: 'Новый заголовок' });
      assert.equal(updated?.title, 'Новый заголовок');
      assert.equal(updated?.place, event.place);
      assert.equal(updated?.description, event.description);

      // Закрытое событие уходит из выборки опубликованных.
      await repos.events.update(event.id, { status: 'closed' });
      const published = await repos.events.listPublished();
      assert.ok(!published.some((row) => row.id === event.id), 'закрытое событие осталось среди опубликованных');
    });

    it('событие: «мои события» — организатор и участник, порядок по дате', async () => {
      const late = await repos.events.create({ ...eventInput(11), startsAt: '2031-01-01T10:00:00.000Z' });
      const early = await repos.events.create({ ...eventInput(12), startsAt: '2030-01-01T10:00:00.000Z' });
      await repos.participants.upsert(participantInput(early.id, 11));

      const list = await repos.events.listForUser(11);
      assert.deepEqual(list.map((row) => row.id), [early.id, late.id]);
      assert.deepEqual(await repos.events.listForUser(99), []);

      const byOrganizer = await repos.events.listByOrganizer(12);
      assert.deepEqual(byOrganizer.map((row) => row.id), [early.id]);
    });

    it('событие: закрываются только начавшиеся и только опубликованные', async () => {
      const past = await repos.events.create({ ...eventInput(), startsAt: '2020-01-01T10:00:00.000Z' });
      const future = await repos.events.create({ ...eventInput(), startsAt: '2030-01-01T10:00:00.000Z' });
      const alreadyClosed = await repos.events.create({ ...eventInput(), startsAt: '2020-01-01T10:00:00.000Z' });
      await repos.events.update(alreadyClosed.id, { status: 'closed' });

      const closed = await repos.events.closeStartedBefore(new Date('2025-01-01T00:00:00.000Z'));
      assert.deepEqual(closed.map((row) => row.id), [past.id]);
      assert.equal((await repos.events.findById(past.id))?.status, 'closed');
      assert.equal((await repos.events.findById(future.id))?.status, 'published');

      // Повторный вызов ничего не находит: закрывать больше нечего.
      assert.deepEqual(await repos.events.closeStartedBefore(new Date('2025-01-01T00:00:00.000Z')), []);
    });

    it('участники: повторная запись обновляет ту же заявку и заменяет ответы', async () => {
      const event = await repos.events.create(eventInput());
      const first = await repos.participants.upsert(
        participantInput(event.id, 7, { answers: { fld_size: 'S' } }),
      );
      const second = await repos.participants.upsert(
        participantInput(event.id, 7, { name: 'Аня', answers: {} }),
      );

      assert.equal(second.id, first.id, 'повторная запись создала вторую заявку');
      assert.deepEqual(second.answers, {}, 'ответы не заменились целиком');
      assert.equal((await repos.participants.listByEvent(event.id)).length, 1);
      assert.equal((await repos.participants.find(event.id, 7))?.name, 'Аня');

      // Патч меняет только переданное поле.
      const patched = await repos.participants.patch(event.id, 7, { status: 'maybe' });
      assert.equal(patched?.status, 'maybe');
      assert.equal(patched?.name, 'Аня');
      assert.equal(await repos.participants.patch(event.id, 404, { status: 'maybe' }), null);

      assert.equal(await repos.participants.delete(event.id, 7), true);
      assert.equal(await repos.participants.find(event.id, 7), null);
      assert.equal(await repos.participants.delete(event.id, 7), false);
    });

    it('участники: выборки по событию и по пользователю', async () => {
      const event = await repos.events.create(eventInput());
      const other = await repos.events.create(eventInput());
      await repos.participants.upsert(participantInput(event.id, 7));
      await repos.participants.upsert(participantInput(other.id, 7));

      assert.equal((await repos.participants.listByEvent(event.id)).length, 1);
      assert.equal((await repos.participants.listByUser(7)).length, 2);
      assert.deepEqual(await repos.participants.listByEvent('evt_нет'), []);
    });

    it('список покупок: нумерация продолжается, бронь эксклюзивна', async () => {
      const event = await repos.events.create(eventInput());
      const first = await repos.items.addMany(event.id, ['Продукты', '   ', 'Вода']);
      assert.deepEqual(first.map((item) => item.title), ['Продукты', 'Вода']);
      assert.deepEqual(first.map((item) => item.position), [1, 2]);

      const second = await repos.items.addMany(event.id, ['Уголь']);
      assert.equal(second.find((item) => item.title === 'Уголь')?.position, 3);

      const reserved = await repos.items.reserve(first[0]!.id, event.id, 7, 'Аня');
      assert.ok(reserved.reserved, 'позиция не забронировалась');

      // Второй человек видит, кому досталась позиция.
      const taken = await repos.items.reserve(first[0]!.id, event.id, 8, 'Боря');
      assert.equal(taken.reserved, null);
      assert.equal(taken.takenBy, 'Аня');
      assert.equal(taken.alreadyMine, false);

      // Тот же человек получает «уже моя», а не ошибку.
      const again = await repos.items.reserve(first[0]!.id, event.id, 7, 'Аня');
      assert.equal(again.alreadyMine, true);
      assert.equal(again.takenBy, null);

      // Снять бронь может только владелец.
      assert.equal(await repos.items.release(first[0]!.id, 8), false);
      assert.equal(await repos.items.release(first[0]!.id, 7), true);
      assert.equal((await repos.items.listByEvent(event.id))[0]?.reservation, null);
    });

    it('список покупок: освобождение броней и удаление позиции', async () => {
      const event = await repos.events.create(eventInput());
      const items = await repos.items.addMany(event.id, ['Продукты', 'Вода']);
      await repos.items.reserve(items[0]!.id, event.id, 7, 'Аня');
      await repos.items.reserve(items[1]!.id, event.id, 8, 'Боря');

      assert.equal(await repos.items.releaseAllForUser(event.id, 7), 1);
      const fresh = await repos.items.listByEvent(event.id);
      assert.equal(fresh[0]?.reservation, null);
      assert.equal(fresh[1]?.reservation?.userId, 8);
      assert.deepEqual(await repos.items.listReservedByUser(event.id, 7), []);
      assert.equal((await repos.items.listReservedByUser(event.id, 8)).length, 1);

      // Удаление позиции снимает бронь — как ON DELETE CASCADE в схеме.
      assert.equal(await repos.items.deleteItem(items[1]!.id), true);
      assert.equal(await repos.items.deleteItem(items[1]!.id), false);
      assert.equal((await repos.items.listByEvent(event.id)).length, 1);
      assert.equal(await repos.items.findById(items[1]!.id), null);
    });

    it('наборы вопросов принадлежат владельцу', async () => {
      const template = await repos.templates.create(5, 'Мой набор', [field()]);
      assert.equal((await repos.templates.listByOwner(5)).length, 1);
      assert.equal((await repos.templates.find(template.id))?.name, 'Мой набор');

      // Чужой владелец не видит и не меняет набор.
      assert.deepEqual(await repos.templates.listByOwner(6), []);
      assert.equal(await repos.templates.rename(template.id, 6, 'Угнал'), null);
      assert.equal(await repos.templates.updateFields(template.id, 6, []), null);
      assert.equal(await repos.templates.delete(template.id, 6), false);

      assert.equal((await repos.templates.rename(template.id, 5, 'Переименован'))?.name, 'Переименован');
      assert.equal((await repos.templates.updateFields(template.id, 5, [field({ label: 'Возраст' })]))?.fields[0]?.label, 'Возраст');
      assert.equal(await repos.templates.delete(template.id, 5), true);
      assert.equal(await repos.templates.find(template.id), null);
    });

    it('профиль: пустое значение не затирает сохранённое', async () => {
      const created = await repos.users.ensure(7, { name: 'Аня', username: 'anya' });
      const createdAt = await repos.users.createdAt(7);
      assert.ok(createdAt, 'дата регистрации не сохранилась');
      assert.equal(created.username, 'anya');

      const touched = await repos.users.ensure(7, { name: '', contact: '' });
      assert.equal(touched.name, 'Аня', 'пустое имя затёрло сохранённое');
      assert.equal(touched.username, 'anya');
      assert.equal(await repos.users.createdAt(7), createdAt);

      const withContact = await repos.users.saveContact(7, '+7 900 000-00-00');
      assert.equal(withContact.contact, '+7 900 000-00-00');
      assert.equal((await repos.users.find(7))?.contact, '+7 900 000-00-00');
      assert.equal(await repos.users.find(404), null);
      assert.equal(await repos.users.createdAt(404), null);
    });

    it('критическая секция сериализует работу по ключу события', async () => {
      let counter = 0;
      const bump = async (): Promise<void> => {
        const current = counter;
        await new Promise((resolve) => setTimeout(resolve, 5));
        counter = current + 1;
      };

      await Promise.all([
        repos.events.withLock('evt_one', bump),
        repos.events.withLock('evt_one', bump),
        repos.events.withLock('evt_one', bump),
      ]);
      assert.equal(counter, 3, 'очередь по ключу не сработала');

      // Разные ключи не мешают друг другу, а ошибка внутри секции не блокирует очередь.
      const order: string[] = [];
      await Promise.all([
        repos.events.withLock('evt_a', async () => { order.push('a'); }),
        repos.events.withLock('evt_b', async () => { order.push('b'); }),
      ]);
      assert.equal(order.length, 2);

      await assert.rejects(
        repos.events.withLock('evt_two', async () => {
          throw new Error('сбой внутри секции');
        }),
        /сбой внутри секции/,
      );
      assert.equal(await repos.events.withLock('evt_two', async () => 'ок'), 'ок');
    });
  });
};
