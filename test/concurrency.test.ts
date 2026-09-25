import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createMemoryRepositories } from '../src/db/memory/index.js';
import { EventService } from '../src/services/eventService.js';
import { ItemService } from '../src/services/itemService.js';
import { ParticipantService } from '../src/services/participantService.js';
import { hoursFromNow, startHarness, testConfig, type Harness } from './support.js';

/**
 * Гонки, которые ломали основной сценарий: две одновременные заявки на последнее
 * место и параллельное добавление позиций списка покупок. База такие инварианты
 * не держит, поэтому решения о составе и нумерации идут через критическую секцию
 * по событию (`db/locks.ts`).
 *
 * Проверяем обе реализации хранилища: PostgreSQL и память — поведение должно
 * совпадать, иначе при обрыве связи бот начнёт пускать лишних людей в состав.
 */
describe('Гонки: лимит мест и нумерация позиций (PostgreSQL)', () => {
  let harness: Harness;

  before(async () => {
    harness = await startHarness();
  });

  after(async () => {
    await harness.stop();
  });

  const register = (
    event: Awaited<ReturnType<typeof harness.events.create>>,
    userId: number,
    name: string,
  ) =>
    harness.participants.save({
      event,
      userId,
      name,
      username: null,
      contact: '',
      status: 'going',
      answers: {},
    });

  it('две одновременные заявки на последнее место: один в составе, второй в листе ожидания', async () => {
    const event = await harness.events.create({
      title: 'Одно место',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'кафе',
      placeCoords: null,
      limit: 1,
      fields: [],
      organizerId: 500,
      organizerName: 'Оля',
    });

    await Promise.all([register(event, 1, 'Аня'), register(event, 2, 'Боря')]);

    const participants = await harness.participants.listByEvent(event.id);
    const going = participants.filter((item) => item.status === 'going' && !item.waitlisted);
    const waiting = participants.filter((item) => item.waitlisted);
    assert.equal(going.length, 1, `в составе оказалось ${going.length} человека`);
    assert.equal(waiting.length, 1, `в листе ожидания ${waiting.length}`);
  });

  it('пять одновременных заявок при лимите 2: лишние уходят в лист ожидания', async () => {
    const event = await harness.events.create({
      title: 'Два места',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'кафе',
      placeCoords: null,
      limit: 2,
      fields: [],
      organizerId: 500,
      organizerName: 'Оля',
    });

    await Promise.all([1, 2, 3, 4, 5].map((userId) => register(event, 600 + userId, `Гость ${userId}`)));

    const participants = await harness.participants.listByEvent(event.id);
    assert.equal(participants.filter((item) => item.status === 'going' && !item.waitlisted).length, 2);
    assert.equal(participants.filter((item) => item.waitlisted).length, 3);
  });

  it('параллельное добавление позиций не даёт одинаковых номеров', async () => {
    const event = await harness.events.create({
      title: 'Покупки',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'кафе',
      placeCoords: null,
      limit: null,
      fields: [],
      organizerId: 500,
      organizerName: 'Оля',
    });

    await Promise.all([
      harness.items.add(event.id, ['Продукты']),
      harness.items.add(event.id, ['Вода']),
      harness.items.add(event.id, ['Настолки']),
    ]);

    const items = await harness.items.list(event.id);
    const positions = items.map((item) => item.position).sort((left, right) => left - right);
    assert.equal(items.length, 3);
    assert.deepEqual(positions, [1, 2, 3], `номера позиций: ${positions.join(', ')}`);
  });

  it('два одновременных отказа поднимают из листа ожидания ровно одного', async () => {
    const event = await harness.events.create({
      title: 'Два места',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'кафе',
      placeCoords: null,
      limit: 2,
      fields: [],
      organizerId: 500,
      organizerName: 'Оля',
    });

    await register(event, 10, 'Аня');
    await register(event, 11, 'Боря');
    const third = await register(event, 12, 'Вика');
    assert.equal(third.ok && third.waitlisted, true, 'Вика должна попасть в лист ожидания');

    // Оба «идущих» отказываются одновременно: свободных мест два, ожидающий один —
    // он и должен подняться, причём ровно один раз.
    await Promise.all([
      harness.participants.setStatus(event, 10, 'not_going'),
      harness.participants.setStatus(event, 11, 'not_going'),
    ]);

    const participants = await harness.participants.listByEvent(event.id);
    const going = participants.filter((item) => item.status === 'going' && !item.waitlisted);
    assert.deepEqual(going.map((item) => item.name), ['Вика']);
    assert.equal(participants.filter((item) => item.waitlisted).length, 0);
  });

  it('оба отказавшихся одновременно: состав пуст, лишних людей нет', async () => {
    const event = await harness.events.create({
      title: 'Одно место',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'кафе',
      placeCoords: null,
      limit: 1,
      fields: [],
      organizerId: 500,
      organizerName: 'Оля',
    });

    await register(event, 20, 'Аня');
    const second = await register(event, 21, 'Боря');
    assert.equal(second.ok && second.waitlisted, true);

    await Promise.all([
      harness.participants.setStatus(event, 20, 'not_going'),
      harness.participants.setStatus(event, 21, 'not_going'),
    ]);

    const participants = await harness.participants.listByEvent(event.id);
    // Оба отказались — идти некому; главное, что не появилось «лишнего» участника.
    assert.equal(participants.filter((item) => item.status === 'going' && !item.waitlisted).length, 0);
    assert.equal(participants.filter((item) => item.waitlisted).length, 0);
  });
});

describe('Гонки: лимит мест и нумерация позиций (память)', () => {
  const build = () => {
    const repos = createMemoryRepositories();
    const config = testConfig();
    return {
      repos,
      events: new EventService(repos, config),
      participants: new ParticipantService(repos),
      items: new ItemService(repos),
    };
  };

  const createEvent = (
    services: ReturnType<typeof build>,
    limit: number | null,
  ) =>
    services.events.create({
      title: 'Память',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'кафе',
      placeCoords: null,
      limit,
      fields: [],
      organizerId: 500,
      organizerName: 'Оля',
    });

  it('две одновременные заявки на последнее место разводятся так же, как в базе', async () => {
    const services = build();
    const event = await createEvent(services, 1);

    await Promise.all([
      services.participants.save({
        event, userId: 1, name: 'Аня', username: null, contact: '', status: 'going', answers: {},
      }),
      services.participants.save({
        event, userId: 2, name: 'Боря', username: null, contact: '', status: 'going', answers: {},
      }),
    ]);

    const participants = await services.participants.listByEvent(event.id);
    assert.equal(participants.filter((item) => item.status === 'going' && !item.waitlisted).length, 1);
    assert.equal(participants.filter((item) => item.waitlisted).length, 1);
  });

  it('параллельное добавление позиций нумерует их подряд', async () => {
    const services = build();
    const event = await createEvent(services, null);

    await Promise.all([
      services.items.add(event.id, ['Продукты']),
      services.items.add(event.id, ['Вода']),
    ]);

    const items = await services.items.list(event.id);
    const positions = items.map((item) => item.position).sort((left, right) => left - right);
    assert.deepEqual(positions, [1, 2]);
  });
});
