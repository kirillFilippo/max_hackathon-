import { KeyedLocks } from '../locks.js';
import { newEventCode, newEventId } from '../../domain/ids.js';
import { normalizeFields } from '../../domain/questionnaire.js';
import type {
  DosugEvent,
  EventField,
  EventItem,
  ItemWithReservation,
  Participant,
  Reservation,
  Template,
  UserProfile,
} from '../../domain/types.js';
import type {
  CreateEventRecord,
  EventPatch,
  EventsRepository,
  ItemsRepository,
  ParticipantPatch,
  ParticipantsRepository,
  Repositories,
  ReserveResult,
  SaveParticipantInput,
  TemplatesRepository,
  UserPatch,
  UsersRepository,
} from '../repositories/contracts.js';
import { MemoryStore } from './store.js';
import type { MemorySnapshot, StoredUserProfile } from './store.js';

/**
 * Репозитории поверх памяти: та же семантика, что у PostgreSQL-версии
 * (`../repositories/*Repo.ts`). Нужны, чтобы бот работал при недоступной базе,
 * а накопленное состояние потом уехало в БД через `MemoryStore.snapshot()`.
 *
 * Порядок сортировки, состав полей и null-значения повторяют SQL: расхождение
 * здесь заметно сервисам, которые не знают, откуда пришли данные.
 */

export { MemoryStore };
export type { MemorySnapshot, StoredUserProfile };

import { mapEvent, nowIso, sortByTime } from './helpers.js';

export class MemoryEventsRepository implements EventsRepository {
  /** Та же очередь критических секций, что и в PostgreSQL-реализации. */
  private readonly locks = new KeyedLocks();

  constructor(private readonly store: MemoryStore) {}

  withLock<T>(eventId: string, work: () => Promise<T>): Promise<T> {
    return this.locks.run(eventId, work);
  }

  /** Создаёт событие, подбирая свободный короткий код (в БД это UNIQUE). */
  async create(input: CreateEventRecord, attempts = 12): Promise<DosugEvent> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const code = newEventCode();
      if (this.store.eventByCode(code)) continue;

      const now = nowIso();
      const event: DosugEvent = {
        id: newEventId(),
        code,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        place: input.place,
        placeCoords: input.placeCoords ? { lat: input.placeCoords.lat, lon: input.placeCoords.lon } : null,
        limit: input.limit,
        fields: normalizeFields(input.fields),
        answerMode: input.answerMode ?? 'auto',
        status: 'published',
        organizerId: input.organizerId,
        organizerName: input.organizerName,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
      };
      this.store.putEvent(event);
      return mapEvent(event);
    }
    throw new Error('Не удалось подобрать свободный код события');
  }

  async findById(id: string): Promise<DosugEvent | null> {
    const event = this.store.event(id);
    return event ? mapEvent(event) : null;
  }

  async findByCode(code: string): Promise<DosugEvent | null> {
    const event = this.store.eventByCode(code.trim().toUpperCase());
    return event ? mapEvent(event) : null;
  }

  async listByOrganizer(organizerId: number): Promise<DosugEvent[]> {
    const events = this.store
      .events()
      .filter((event) => event.organizerId === organizerId)
      .map(mapEvent);
    return sortByTime(events, (event) => event.startsAt);
  }

  async listPublished(): Promise<DosugEvent[]> {
    const events = this.store
      .events()
      .filter((event) => event.status === 'published')
      .map(mapEvent);
    return sortByTime(events, (event) => event.startsAt);
  }

  /** Применяет только переданные поля; пустой патч ничего не меняет. */
  async update(id: string, patch: EventPatch): Promise<DosugEvent | null> {
    const current = this.store.event(id);
    if (!current) return null;

    const changed =
      patch.title !== undefined ||
      patch.description !== undefined ||
      patch.startsAt !== undefined ||
      patch.place !== undefined ||
      patch.placeCoords !== undefined ||
      patch.limit !== undefined ||
      patch.fields !== undefined ||
      patch.answerMode !== undefined ||
      patch.status !== undefined ||
      patch.closedAt !== undefined;
    if (!changed) return mapEvent(current);

    const updated: DosugEvent = { ...current, updatedAt: nowIso() };
    if (patch.title !== undefined) updated.title = patch.title;
    if (patch.description !== undefined) updated.description = patch.description;
    if (patch.startsAt !== undefined) updated.startsAt = patch.startsAt;
    if (patch.place !== undefined) updated.place = patch.place;
    if (patch.placeCoords !== undefined) {
      updated.placeCoords = patch.placeCoords
        ? { lat: patch.placeCoords.lat, lon: patch.placeCoords.lon }
        : null;
    }
    if (patch.limit !== undefined) updated.limit = patch.limit;
    if (patch.fields !== undefined) updated.fields = normalizeFields(patch.fields);
    if (patch.answerMode !== undefined) updated.answerMode = patch.answerMode;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.closedAt !== undefined) updated.closedAt = patch.closedAt;

    this.store.putEvent(updated);
    return mapEvent(updated);
  }

  /** Закрывает опубликованные события, начавшиеся раньше порога. */
  async closeStartedBefore(threshold: Date): Promise<DosugEvent[]> {
    const limit = threshold.getTime();
    const now = nowIso();
    const closed: DosugEvent[] = [];
    for (const event of this.store.events()) {
      if (event.status !== 'published') continue;
      const startsAt = Date.parse(event.startsAt);
      // Даты сравниваем как моменты времени: ISO-строки могут прийти с другим смещением.
      if (!Number.isFinite(startsAt) || startsAt >= limit) continue;
      const updated: DosugEvent = { ...event, status: 'closed', closedAt: now, updatedAt: now };
      this.store.putEvent(updated);
      closed.push(mapEvent(updated));
    }
    // В SQL порядок UPDATE ... RETURNING не определён; здесь он детерминированный.
    return sortByTime(closed, (event) => event.startsAt);
  }

  /** События, где пользователь организатор или участник — для «Моих событий». */
  async listForUser(userId: number): Promise<DosugEvent[]> {
    const participated = new Set(
      this.store
        .participants()
        .filter((participant) => participant.userId === userId)
        .map((participant) => participant.eventId),
    );
    const events = this.store
      .events()
      .filter((event) => event.organizerId === userId || participated.has(event.id))
      .map(mapEvent);
    return sortByTime(events, (event) => event.startsAt);
  }
}
