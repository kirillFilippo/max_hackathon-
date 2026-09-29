import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMemoryRepositories, MemoryStore } from '../src/db/memory/index.js';
import type { MemorySnapshot } from '../src/db/memory/index.js';
import type {
  CreateEventRecord,
  Repositories,
  SaveParticipantInput,
} from '../src/db/repositories/contracts.js';
import type {
  DosugEvent,
  EventField,
  EventItem,
  Participant,
  Reservation,
  Template,
  UserProfile,
} from '../src/domain/types.js';

/**
 * Проверяем не «наивную» реализацию, а те места, где память обязана совпасть
 * с PostgreSQL: эксклюзивность брони, слияние ответов, порядок выборок,
 * точечная запись «зеркала» и перенос состояния через снимок.
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

const eventInput = (overrides: Partial<CreateEventRecord> = {}): CreateEventRecord => ({
  title: 'Пикник',
  description: 'Поездка на природу',
  startsAt: '2030-06-01T10:00:00.000Z',
  place: 'Парк',
  placeCoords: null,
  limit: null,
  fields: [],
  organizerId: 1,
  organizerName: 'Аня',
  ...overrides,
});

const participantInput = (
  eventId: string,
  overrides: Partial<SaveParticipantInput> = {},
): SaveParticipantInput => ({
  eventId,
  userId: 7,
  name: 'Боря',
  username: 'boris',
  contact: '+7 999 000-00-00',
  status: 'going',
  answers: {},
  waitlisted: false,
  ...overrides,
});

const eventRecord = (overrides: Partial<DosugEvent> = {}): DosugEvent => ({
  id: 'evt_mirror',
  code: 'ABC23',
  title: 'Зеркальное событие',
  description: '',
  startsAt: '2031-01-01T12:00:00.000Z',
  place: 'Кафе',
  placeCoords: null,
  limit: null,
  fields: [],
  answerMode: 'auto',
  status: 'published',
  organizerId: 1,
  organizerName: 'Аня',
  createdAt: '2030-12-01T00:00:00.000Z',
  updatedAt: '2030-12-01T00:00:00.000Z',
  closedAt: null,
  ...overrides,
});

const participantRecord = (overrides: Partial<Participant> = {}): Participant => ({
  id: 'prt_mirror',
  eventId: 'evt_mirror',
  userId: 7,
  name: 'Боря',
  username: 'boris',
  contact: '+7 999 000-00-00',
  status: 'going',
  answers: {},
  waitlisted: false,
  confirmSentAt: null,
  finalSentAt: null,
  createdAt: '2030-12-01T00:00:00.000Z',
  updatedAt: '2030-12-01T00:00:00.000Z',
  ...overrides,
});

const itemRecord = (overrides: Partial<EventItem> = {}): EventItem => ({
  id: 'itm_mirror',
  eventId: 'evt_mirror',
  title: 'Торт',
  position: 1,
  createdAt: '2030-12-01T00:00:00.000Z',
  ...overrides,
});

const reservationRecord = (overrides: Partial<Reservation> = {}): Reservation => ({
  itemId: 'itm_mirror',
  eventId: 'evt_mirror',
  userId: 9,
  userName: 'Вика',
  reservedAt: '2030-12-01T00:00:00.000Z',
  note: '',
  ...overrides,
});

const templateRecord = (overrides: Partial<Template> = {}): Template => ({
  id: 'tpl_mirror',
  name: 'Пикник',
  fields: [],
  builtin: false,
  ownerId: 1,
  createdAt: '2030-12-01T00:00:00.000Z',
  ...overrides,
});


const userProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  userId: 5,
  name: 'Аня',
  username: 'anya',
  contact: '+7 999 000-00-00',
  ...overrides,
});

describe('память: события', () => {
  it('create подбирает код, публикует событие и нормализует анкету', async () => {
    const repos: Repositories = createMemoryRepositories();
    const event = await repos.events.create(
      eventInput({
        fields: [field()],
        limit: 8,
        placeCoords: { lat: 55.75, lon: 37.61 },
        answerMode: 'miniapp',
      }),
    );

    assert.equal(event.code.length, 5);
    assert.equal(event.code, event.code.toUpperCase());
    assert.equal(event.status, 'published');
    assert.equal(event.closedAt, null);
    assert.equal(event.answerMode, 'miniapp');
    assert.deepEqual(event.placeCoords, { lat: 55.75, lon: 37.61 });
    assert.equal(event.limit, 8);
    assert.deepEqual(event.fields, [field()]);
    assert.equal(event.createdAt, event.updatedAt);
    assert.equal(await repos.events.findById(event.id).then((found) => found?.id), event.id);
  });

  it('findByCode игнорирует регистр и пробелы', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());

    assert.equal((await repos.events.findByCode(` ${event.code.toLowerCase()} `))?.id, event.id);
    assert.equal(await repos.events.findByCode('НЕТТАКОГО'), null);
    assert.equal(await repos.events.findById('evt_unknown'), null);
  });

  it('update применяет только переданные поля, а пустой патч ничего не меняет', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput({ fields: [field()] }));

    const updated = await repos.events.update(event.id, { title: 'Шашлыки', limit: 4 });
    assert.equal(updated?.title, 'Шашлыки');
    assert.equal(updated?.limit, 4);
    assert.equal(updated?.description, 'Поездка на природу');
    assert.equal(updated?.place, 'Парк');
    assert.deepEqual(updated?.fields, [field()]);
    assert.equal(updated?.answerMode, 'auto');

    const untouched = await repos.events.update(event.id, {});
    assert.deepEqual(untouched, updated);

    const closed = await repos.events.update(event.id, { status: 'closed', closedAt: null });
    assert.equal(closed?.status, 'closed');
    assert.equal(closed?.closedAt, null);

    assert.equal(await repos.events.update('evt_unknown', { title: 'Мимо' }), null);
  });

  it('listPublished и listByOrganizer сортируют по началу события', async () => {
    const repos = createMemoryRepositories();
    const later = await repos.events.create(
      eventInput({ title: 'Позже', startsAt: '2030-06-03T10:00:00.000Z' }),
    );
    const sooner = await repos.events.create(
      eventInput({ title: 'Раньше', startsAt: '2030-06-01T10:00:00.000Z', organizerId: 2 }),
    );
    const middle = await repos.events.create(
      eventInput({ title: 'В середине', startsAt: '2030-06-02T10:00:00.000Z' }),
    );

    assert.deepEqual(
      (await repos.events.listPublished()).map((event) => event.title),
      ['Раньше', 'В середине', 'Позже'],
    );
    assert.deepEqual(
      (await repos.events.listByOrganizer(1)).map((event) => event.id),
      [middle.id, later.id],
    );
    assert.deepEqual(
      (await repos.events.listByOrganizer(2)).map((event) => event.id),
      [sooner.id],
    );
  });

  it('listForUser включает события и организатора, и участника', async () => {
    const repos = createMemoryRepositories();
    const asOrganizer = await repos.events.create(
      eventInput({ organizerId: 10, startsAt: '2030-06-02T10:00:00.000Z' }),
    );
    const asParticipant = await repos.events.create(
      eventInput({ organizerId: 20, startsAt: '2030-06-01T10:00:00.000Z' }),
    );
    const alien = await repos.events.create(
      eventInput({ organizerId: 20, startsAt: '2030-06-03T10:00:00.000Z' }),
    );
    await repos.participants.upsert(participantInput(asParticipant.id, { userId: 10 }));
    await repos.participants.upsert(participantInput(alien.id, { userId: 30 }));

    assert.deepEqual(
      (await repos.events.listForUser(10)).map((event) => event.id),
      [asParticipant.id, asOrganizer.id],
    );
    assert.deepEqual(await repos.events.listForUser(99), []);
  });

  it('closeStartedBefore закрывает только прошедшие опубликованные события', async () => {
    const repos = createMemoryRepositories();
    const past = await repos.events.create(
      eventInput({ title: 'Прошлое', startsAt: new Date(Date.now() - 3_600_000).toISOString() }),
    );
    const future = await repos.events.create(
      eventInput({ title: 'Будущее', startsAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );
    const alreadyClosed = await repos.events.create(
      eventInput({ title: 'Закрытое', startsAt: past.startsAt }),
    );
    await repos.events.update(alreadyClosed.id, { status: 'closed' });

    const closed = await repos.events.closeStartedBefore(new Date());
    assert.deepEqual(closed.map((event) => event.title), ['Прошлое']);
    assert.equal(closed[0]!.status, 'closed');
    assert.notEqual(closed[0]!.closedAt, null);

    assert.equal((await repos.events.findById(past.id))?.status, 'closed');
    assert.equal((await repos.events.findById(future.id))?.status, 'published');
    // Уже закрытое событие повторно не трогаем: closedAt остался прежним.
    assert.equal((await repos.events.findById(alreadyClosed.id))?.closedAt, null);
    assert.deepEqual(await repos.events.closeStartedBefore(new Date(Date.now() - 7_200_000)), []);
  });
});

describe('память: участники', () => {
  it('upsert и patch заменяют ответы целиком (как в базе: слияние не даёт снять ответ)', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());

    const first = await repos.participants.upsert(
      participantInput(event.id, { answers: { size: 'M' }, status: 'maybe' }),
    );
    const second = await repos.participants.upsert(
      participantInput(event.id, {
        name: 'Борис',
        answers: { color: 'красный', size: 'L' },
        status: 'going',
      }),
    );

    assert.equal(second.id, first.id);
    assert.equal(second.createdAt, first.createdAt);
    assert.equal(second.name, 'Борис');
    assert.equal(second.status, 'going');
    assert.deepEqual(second.answers, { size: 'L', color: 'красный' });

    // Главное отличие замены от слияния: пропущенный ключ исчезает.
    const third = await repos.participants.upsert(participantInput(event.id, { answers: { size: 'S' } }));
    assert.deepEqual(third.answers, { size: 'S' });

    const patched = await repos.participants.patch(event.id, 7, {
      answers: { size: 'S' },
      confirmSentAt: '2030-05-01T00:00:00.000Z',
    });
    assert.deepEqual(patched?.answers, { size: 'S' });
    assert.equal(patched?.confirmSentAt, '2030-05-01T00:00:00.000Z');

    const cleared = await repos.participants.patch(event.id, 7, {
      confirmSentAt: null,
      finalSentAt: null,
    });
    assert.equal(cleared?.confirmSentAt, null);
    assert.equal(cleared?.finalSentAt, null);
    assert.deepEqual(cleared?.answers, { size: 'S' });

    assert.equal(await repos.participants.patch(event.id, 404, { name: 'Никто' }), null);
    assert.deepEqual(await repos.participants.patch(event.id, 7, {}), cleared);
  });

  it('лист ожидания хранится как флаг', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());

    const waitlisted = await repos.participants.upsert(
      participantInput(event.id, { waitlisted: true }),
    );
    assert.equal(waitlisted.waitlisted, true);
    assert.equal((await repos.participants.find(event.id, 7))?.waitlisted, true);

    const admitted = await repos.participants.patch(event.id, 7, { waitlisted: false });
    assert.equal(admitted?.waitlisted, false);
    assert.equal((await repos.participants.find(event.id, 7))?.waitlisted, false);
  });

  it('listByEvent по возрастанию createdAt, listByUser по убыванию, delete по ключу', async () => {
    const store = new MemoryStore();
    const repos = createMemoryRepositories(store);
    const firstEvent = await repos.events.create(eventInput({ startsAt: '2030-06-01T10:00:00.000Z' }));
    const secondEvent = await repos.events.create(eventInput({ startsAt: '2030-06-02T10:00:00.000Z' }));

    store.putParticipant(
      participantRecord({
        id: 'prt_late',
        eventId: firstEvent.id,
        userId: 2,
        name: 'Второй',
        createdAt: '2030-01-02T00:00:00.000Z',
      }),
    );
    store.putParticipant(
      participantRecord({
        id: 'prt_early',
        eventId: firstEvent.id,
        userId: 1,
        name: 'Первый',
        createdAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    store.putParticipant(
      participantRecord({
        id: 'prt_other',
        eventId: secondEvent.id,
        userId: 1,
        name: 'Первый',
        createdAt: '2030-01-03T00:00:00.000Z',
      }),
    );

    assert.deepEqual(
      (await repos.participants.listByEvent(firstEvent.id)).map((participant) => participant.name),
      ['Первый', 'Второй'],
    );
    assert.deepEqual(
      (await repos.participants.listByUser(1)).map((participant) => participant.eventId),
      [secondEvent.id, firstEvent.id],
    );

    assert.equal(await repos.participants.delete(firstEvent.id, 1), true);
    assert.equal(await repos.participants.delete(firstEvent.id, 1), false);
    assert.equal(await repos.participants.find(firstEvent.id, 1), null);
    assert.deepEqual(
      (await repos.participants.listByEvent(firstEvent.id)).map((participant) => participant.id),
      ['prt_late'],
    );
  });
});

describe('память: список покупок', () => {
  it('addMany обрезает заголовки, пропускает пустые и нумерует позиции по порядку', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());
    const long = 'х'.repeat(200);

    const added = await repos.items.addMany(event.id, ['Сок', '   ', long, 'Хлеб  ']);
    assert.deepEqual(added.map((item) => item.position), [1, 2, 3]);
    assert.deepEqual(
      added.map((item) => item.title),
      ['Сок', long.slice(0, 160), 'Хлеб'],
    );
    assert.equal(added[1]!.title.length, 160);

    const more = await repos.items.addMany(event.id, ['Вода']);
    assert.deepEqual(more.map((item) => item.position), [1, 2, 3, 4]);
    assert.deepEqual(
      (await repos.items.listByEvent(event.id)).map((item) => item.title),
      ['Сок', long.slice(0, 160), 'Хлеб', 'Вода'],
    );
    // Пустой ввод ничего не создаёт и ничего не возвращает.
    assert.deepEqual(await repos.items.addMany(event.id, [' ', '']), []);
  });

  it('бронь эксклюзивна: чужому — имя занявшего, своему — alreadyMine', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());
    const [item] = await repos.items.addMany(event.id, ['Торт']);
    const itemId = item!.id;

    const first = await repos.items.reserve(itemId, event.id, 1, 'Аня');
    assert.equal(first.reserved?.reservation?.userId, 1);
    assert.equal(first.reserved?.reservation?.userName, 'Аня');
    assert.equal(first.takenBy, null);
    assert.equal(first.alreadyMine, false);

    const second = await repos.items.reserve(itemId, event.id, 2, 'Боря');
    assert.equal(second.reserved, null);
    assert.equal(second.takenBy, 'Аня');
    assert.equal(second.alreadyMine, false);

    const third = await repos.items.reserve(itemId, event.id, 3, 'Вика');
    assert.equal(third.reserved, null);
    assert.equal(third.takenBy, 'Аня');

    const repeat = await repos.items.reserve(itemId, event.id, 1, 'Аня');
    assert.equal(repeat.reserved, null);
    assert.equal(repeat.takenBy, null);
    assert.equal(repeat.alreadyMine, true);

    const items = await repos.items.listByEvent(event.id);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.reservation?.userId, 1);
    assert.deepEqual(
      (await repos.items.listReservedByUser(event.id, 1)).map((entry) => entry.id),
      [itemId],
    );
    assert.deepEqual(await repos.items.listReservedByUser(event.id, 2), []);
    assert.deepEqual(await repos.items.reserve('itm_unknown', event.id, 1, 'Аня'), {
      reserved: null,
      takenBy: null,
      alreadyMine: false,
    });
  });

  it('одновременные брони одной позиции: побеждает ровно один', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());
    const [item] = await repos.items.addMany(event.id, ['Торт']);

    const [first, second] = await Promise.all([
      repos.items.reserve(item!.id, event.id, 1, 'Аня'),
      repos.items.reserve(item!.id, event.id, 2, 'Боря'),
    ]);
    const winners = [first, second].filter((result) => result.reserved !== null);
    assert.equal(winners.length, 1);
    const loser = [first, second].find((result) => result.reserved === null)!;
    assert.equal(loser.takenBy, winners[0]!.reserved!.reservation!.userName);
    assert.equal((await repos.items.listByEvent(event.id))[0]!.reservation?.userId, 1);
  });

  it('release снимает только свою бронь, releaseAllForUser — все брони пользователя', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());
    const added = await repos.items.addMany(event.id, ['Сок', 'Хлеб', 'Сыр']);
    const [juice, bread, cheese] = added;

    await repos.items.reserve(juice!.id, event.id, 1, 'Аня');
    await repos.items.reserve(bread!.id, event.id, 1, 'Аня');
    await repos.items.reserve(cheese!.id, event.id, 2, 'Боря');

    assert.equal(await repos.items.release(juice!.id, 2), false);
    assert.equal((await repos.items.findById(juice!.id))?.reservation?.userId, 1);
    assert.equal(await repos.items.release(juice!.id, 1), true);
    assert.equal((await repos.items.findById(juice!.id))?.reservation, null);

    assert.equal(await repos.items.releaseAllForUser(event.id, 1), 1);
    assert.equal((await repos.items.findById(bread!.id))?.reservation, null);
    assert.equal((await repos.items.findById(cheese!.id))?.reservation?.userId, 2);
    assert.equal(await repos.items.releaseAllForUser(event.id, 42), 0);
  });

  it('deleteItem удаляет позицию вместе с бронью', async () => {
    const repos = createMemoryRepositories();
    const event = await repos.events.create(eventInput());
    const added = await repos.items.addMany(event.id, ['Сок', 'Хлеб', 'Сыр']);
    const bread = added[1]!;
    await repos.items.reserve(bread.id, event.id, 1, 'Аня');

    assert.equal(await repos.items.deleteItem(bread.id), true);
    assert.equal(await repos.items.findById(bread.id), null);
    assert.equal(await repos.items.release(bread.id, 1), false);
    assert.deepEqual(
      (await repos.items.listByEvent(event.id)).map((item) => item.title),
      ['Сок', 'Сыр'],
    );
    assert.deepEqual(
      (await repos.items.listByEvent(event.id)).map((item) => item.position),
      [1, 3],
    );
    assert.equal(await repos.items.deleteItem(bread.id), false);
  });
});

describe('память: шаблоны и профили', () => {
  it('шаблоны принадлежат владельцу: чужие правки не проходят', async () => {
    const repos = createMemoryRepositories();
    const created = await repos.templates.create(1, 'Пикник', [field()]);

    assert.equal(created.builtin, false);
    assert.equal(created.ownerId, 1);
    assert.deepEqual(
      (await repos.templates.listByOwner(1)).map((template) => template.id),
      [created.id],
    );
    assert.deepEqual(await repos.templates.listByOwner(2), []);

    assert.equal(await repos.templates.rename(created.id, 2, 'Чужое'), null);
    assert.equal(await repos.templates.updateFields(created.id, 2, []), null);
    assert.equal(await repos.templates.delete(created.id, 2), false);
    assert.equal(await repos.templates.rename('tpl_unknown', 1, 'Нет'), null);

    const renamed = await repos.templates.rename(created.id, 1, 'Шашлыки');
    assert.equal(renamed?.name, 'Шашлыки');
    const updated = await repos.templates.updateFields(created.id, 1, [
      field({ id: 'fld_drinks', label: 'Напитки' }),
    ]);
    assert.deepEqual(
      updated?.fields.map((entry) => entry.label),
      ['Напитки'],
    );
    assert.equal((await repos.templates.find(created.id))?.name, 'Шашлыки');
    assert.equal(await repos.templates.delete(created.id, 1), true);
    assert.equal(await repos.templates.find(created.id), null);
  });

  it('ensure создаёт профиль, обновляет непустые поля и хранит дату создания', async () => {
    const repos = createMemoryRepositories();
    const created = await repos.users.ensure(5, {
      name: 'Аня',
      username: 'anya',
      contact: '+7 999 000-00-00',
    });
    assert.deepEqual(created, {
      userId: 5,
      name: 'Аня',
      username: 'anya',
      contact: '+7 999 000-00-00',
    });

    const patched = await repos.users.ensure(5, { username: 'anya_new' });
    assert.equal(patched.name, 'Аня');
    assert.equal(patched.contact, '+7 999 000-00-00');
    assert.equal(patched.username, 'anya_new');

    const empty = await repos.users.ensure(5, { name: '', contact: '' });
    assert.equal(empty.name, 'Аня');
    assert.equal(empty.contact, '+7 999 000-00-00');
    assert.equal(typeof (await repos.users.createdAt(5)), 'string');

    const saved = await repos.users.saveContact(5, '+7 000 000-00-00');
    assert.equal(saved.contact, '+7 000 000-00-00');
    assert.equal((await repos.users.find(5))?.contact, '+7 000 000-00-00');

    const fresh = await repos.users.saveContact(6, '');
    assert.equal(fresh.name, '');
    assert.equal(await repos.users.createdAt(999), null);
    assert.equal(await repos.users.find(999), null);
  });
});

describe('память: снимок и зеркало базы', () => {
  it('createMemoryRepositories возвращает объект, совместимый с Repositories', async () => {
    const repos: Repositories = createMemoryRepositories();
    assert.deepEqual(
      Object.keys(repos).sort(),
      ['events', 'items', 'participants', 'templates', 'users'],
    );

    const event = await repos.events.create(eventInput());
    assert.equal((await repos.events.findById(event.id))?.title, 'Пикник');
  });

  it('put* кладут сущности, и репозитории их видят', async () => {
    const store = new MemoryStore();
    const repos = createMemoryRepositories(store);

    store.putEvent(eventRecord());
    assert.deepEqual(store.counts(), {
      events: 1,
      participants: 0,
      items: 0,
      reservations: 0,
      templates: 0,
      users: 0,
    });
    assert.equal((await repos.events.findByCode(' abc23 '))?.id, 'evt_mirror');
    assert.equal((await repos.events.listPublished()).length, 1);

    store.putParticipant(participantRecord({ eventId: 'evt_mirror', userId: 7 }));
    assert.equal((await repos.participants.find('evt_mirror', 7))?.id, 'prt_mirror');
    assert.deepEqual(
      (await repos.events.listForUser(7)).map((event) => event.id),
      ['evt_mirror'],
    );

    store.putItem({
      ...itemRecord({ id: 'itm_mirror', eventId: 'evt_mirror' }),
      reservation: reservationRecord({ itemId: 'itm_mirror', eventId: 'evt_mirror', userId: 7 }),
    });
    const found = await repos.items.findById('itm_mirror');
    assert.equal(found?.reservation?.userId, 7);
    assert.deepEqual(
      (await repos.items.listReservedByUser('evt_mirror', 7)).map((item) => item.id),
      ['itm_mirror'],
    );

    store.putTemplate(templateRecord({ ownerId: 3 }));
    assert.deepEqual(
      (await repos.templates.listByOwner(3)).map((template) => template.id),
      ['tpl_mirror'],
    );


    store.putUser(userProfile());
    assert.equal((await repos.users.find(5))?.name, 'Аня');
    assert.equal(typeof (await repos.users.createdAt(5)), 'string');
  });

  it('повторный put* обновляет запись по ключу, putItem с null снимает бронь', async () => {
    const store = new MemoryStore();
    const repos = createMemoryRepositories(store);

    store.putEvent(eventRecord());
    store.putEvent(eventRecord({ title: 'Обновлённое' }));
    assert.equal(store.counts().events, 1);
    assert.equal((await repos.events.findById('evt_mirror'))?.title, 'Обновлённое');

    store.putParticipant(participantRecord({ eventId: 'evt_mirror', userId: 7, name: 'Первый' }));
    store.putParticipant(
      participantRecord({ id: 'prt_two', eventId: 'evt_mirror', userId: 7, name: 'Второй' }),
    );
    assert.equal(store.counts().participants, 1);
    const participant = await repos.participants.find('evt_mirror', 7);
    assert.equal(participant?.id, 'prt_two');
    assert.equal(participant?.name, 'Второй');

    const item = itemRecord({ id: 'itm_mirror', eventId: 'evt_mirror' });
    store.putItem({ ...item, reservation: reservationRecord({ userId: 9, userName: 'Вика' }) });
    store.putItem({ ...item, reservation: reservationRecord({ userId: 8, userName: 'Гриша' }) });
    assert.equal(store.reservations().length, 1);
    assert.equal((await repos.items.findById(item.id))?.reservation?.userId, 8);

    store.putItem({ ...item, reservation: null });
    assert.equal(store.reservations().length, 0);
    assert.equal((await repos.items.findById(item.id))?.reservation, null);


    store.putUser(userProfile({ name: 'Старое' }));
    store.putUser(userProfile({ name: 'Новое' }));
    assert.equal(store.counts().users, 1);
    assert.equal((await repos.users.find(5))?.name, 'Новое');
  });

  it('snapshot сериализуется и восстанавливается в новое хранилище', async () => {
    const store = new MemoryStore();
    const repos = createMemoryRepositories(store);
    const event = await repos.events.create(eventInput({ fields: [field()] }));
    await repos.participants.upsert(participantInput(event.id, { answers: { size: 'M' } }));
    const [item] = await repos.items.addMany(event.id, ['Торт']);
    await repos.items.reserve(item!.id, event.id, 7, 'Боря');
    await repos.templates.create(1, 'Пикник', [field()]);
    await repos.users.ensure(5, { name: 'Аня' });

    assert.equal(store.isEmpty(), false);
    const snapshot = store.snapshot();
    assert.deepEqual(Object.keys(snapshot).sort(), [
      'deletions',
      'events',
      'items',
      'participants',
      'reservations',
      'templates',
      'users',
      'version',
    ]);

    // Снимок должен переживать JSON: никаких Map и Date внутри.
    const restoredSnapshot = JSON.parse(JSON.stringify(snapshot)) as MemorySnapshot;
    const restoredStore = new MemoryStore();
    restoredStore.restore(restoredSnapshot);

    assert.deepEqual(restoredStore.counts(), store.counts());
    assert.equal(restoredStore.isEmpty(), false);

    const restored = createMemoryRepositories(restoredStore);
    const restoredEvent = await restored.events.findByCode(event.code.toLowerCase());
    assert.equal(restoredEvent?.id, event.id);
    assert.deepEqual(restoredEvent?.fields, [field()]);
    assert.equal(
      (await restored.items.findById(item!.id))?.reservation?.userName,
      'Боря',
    );
    assert.deepEqual((await restored.participants.find(event.id, 7))?.answers, { size: 'M' });
    assert.deepEqual(
      (await restored.templates.listByOwner(1)).map((template) => template.name),
      ['Пикник'],
    );
    assert.equal(typeof (await restored.users.createdAt(5)), 'string');
    assert.deepEqual(
      (await restored.events.listForUser(7)).map((entry) => entry.id),
      [event.id],
    );

    restoredStore.clear();
    assert.equal(restoredStore.isEmpty(), true);
    assert.deepEqual(restoredStore.counts(), {
      events: 0,
      participants: 0,
      items: 0,
      reservations: 0,
      templates: 0,
      users: 0,
    });
  });

  it('restore восстанавливает индексы: код события', async () => {
    const store = new MemoryStore();
    const snapshot: MemorySnapshot = {
      version: 1,
      events: [eventRecord({ code: 'ZZZ99' })],
      participants: [participantRecord({ eventId: 'evt_mirror', userId: 7 })],
      items: [itemRecord({ id: 'itm_mirror', eventId: 'evt_mirror' })],
      reservations: [
        reservationRecord({ itemId: 'itm_mirror', eventId: 'evt_mirror', userId: 7, userName: 'Боря' }),
      ],
      templates: [templateRecord()],
      users: [
        {
          ...userProfile(),
          createdAt: '2030-01-01T00:00:00.000Z',
          updatedAt: '2030-01-02T00:00:00.000Z',
        },
      ],
      deletions: { participants: [], items: [], reservations: [], templates: [] },
    };

    store.restore(snapshot);
    const repos = createMemoryRepositories(store);
    assert.equal((await repos.events.findByCode('zzz99'))?.id, 'evt_mirror');
    assert.equal((await repos.items.findById('itm_mirror'))?.reservation?.userName, 'Боря');
    assert.equal(await repos.users.createdAt(5), '2030-01-01T00:00:00.000Z');
    assert.equal((await repos.events.listForUser(7)).length, 1);

    // Повторный restore заменяет состояние, а не дописывает его.
    store.restore({
      version: 1,
      events: snapshot.events,
      participants: [],
      items: [],
      reservations: [],
      templates: [],
      users: [],
      deletions: { participants: [], items: [], reservations: [], templates: [] },
    });
    assert.equal(store.isEmpty(), false);
    assert.equal(store.counts().events, 1);
    assert.deepEqual(store.counts().participants, 0);
  });

  it('наружу не уходят ссылки на внутренние структуры', async () => {
    const store = new MemoryStore();
    const repos = createMemoryRepositories(store);
    const event = await repos.events.create(eventInput({ fields: [field()] }));

    const fromRepo = await repos.events.findById(event.id);
    fromRepo!.title = 'Испорчено';
    fromRepo!.fields.push(field({ id: 'fld_hack' }));
    assert.equal((await repos.events.findById(event.id))?.title, 'Пикник');
    assert.equal((await repos.events.findById(event.id))?.fields.length, 1);

    const fromStore = store.event(event.id);
    fromStore!.title = 'Испорчено';
    assert.equal(store.event(event.id)?.title, 'Пикник');

    const published = await repos.events.listPublished();
    published[0]!.title = 'Испорчено';
    assert.deepEqual(
      (await repos.events.listPublished()).map((entry) => entry.title),
      ['Пикник'],
    );

    store.putEvent(eventRecord());
    const mirrored = store.events();
    mirrored[0]!.title = 'Испорчено';
    assert.equal(store.event('evt_mirror')?.title, 'Зеркальное событие');
  });
});
