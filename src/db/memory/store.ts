import type {
  DosugEvent,
  EventItem,
  ItemWithReservation,
  Participant,
  Reservation,
  Template,
  UserProfile,
} from '../../domain/types.js';

/**
 * Хранилище в памяти: временная замена PostgreSQL.
 *
 * Два сценария использования:
 *  - база недоступна — репозитории работают здесь, а при восстановлении связи
 *    снимок (`snapshot`) переносится в PostgreSQL;
 *  - «зеркало» базы — фасад после успешного запроса в БД кладёт полученные
 *    сущности сюда через `put*`, чтобы при обрыве связи продолжить работу
 *    с тем же состоянием.
 *
 * Наружу отдаются только копии: вызывающий код не может испортить хранилище.
 * Файл не знает ни о сети, ни о диске — снимок сериализуется снаружи.
 */

/** Версия формата снимка: пригодится, если структура данных поменяется. */
export const MEMORY_SNAPSHOT_VERSION = 1;

/**
 * Профиль вместе со служебными датами. В `UserProfile` их нет, а `createdAt`
 * нужен сервисам (например, чтобы отличить новичка от постоянного гостя).
 */
export interface StoredUserProfile extends UserProfile {
  createdAt: string;
  updatedAt: string;
}

/**
 * Удаления, сделанные без связи.
 *
 * Без них синхронизация не может отличить «брони никогда не было» от «бронь сняли
 * в офлайне»: первое трогать нельзя (в базе её мог создать кто-то ещё), второе
 * обязано доехать. То же с заявками, позициями и наборами: удаление, потерянное
 * при переносе, оставляет мусор в базе навсегда.
 */
export interface MemoryDeletions {
  participants: Array<{ eventId: string; userId: number }>;
  items: string[];
  reservations: string[];
  templates: string[];
}

const emptyDeletions = (): MemoryDeletions => ({
  participants: [],
  items: [],
  reservations: [],
  templates: [],
});

/** Снимок состояния: только обычные объекты и массивы — годится для JSON и БД. */
export interface MemorySnapshot {
  version: number;
  events: DosugEvent[];
  participants: Participant[];
  items: EventItem[];
  reservations: Reservation[];
  templates: Template[];
  users: StoredUserProfile[];
  /** Удаления, которые ещё не применены в базе (см. `MemoryDeletions`). */
  deletions: MemoryDeletions;
}

/** Копия сущности: хранилище не делится внутренними ссылками с вызывающим кодом. */
const copy = <T>(value: T): T => structuredClone(value);

/** Ключ участника: в БД это UNIQUE (event_id, user_id). */
const participantKey = (eventId: string, userId: number): string => `${eventId}\u0000${userId}`;

/** Список из снимка: JSON с диска может прийти неполным. */
const snapshotList = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);

export class MemoryStore {
  private readonly eventById = new Map<string, DosugEvent>();
  /** Индекс по короткому коду: в БД это UNIQUE (code). */
  private readonly eventIdByCode = new Map<string, string>();
  private readonly participantByKey = new Map<string, Participant>();
  private readonly itemById = new Map<string, EventItem>();
  /** Бронь на позицию: ключ item_id — как первичный ключ reservations. */
  private readonly reservationByItemId = new Map<string, Reservation>();
  private readonly templateById = new Map<string, Template>();
  private readonly userById = new Map<number, StoredUserProfile>();

  // --- удаления, которые ещё не уехали в базу ---
  private readonly deletedParticipantByKey = new Map<string, { eventId: string; userId: number }>();
  private readonly deletedItemIds = new Set<string>();
  private readonly deletedReservationIds = new Set<string>();
  private readonly deletedTemplateIds = new Set<string>();

  // --- чтение: наружу уходят только копии ---

  events(): DosugEvent[] {
    return [...this.eventById.values()].map(copy);
  }

  event(id: string): DosugEvent | null {
    const found = this.eventById.get(id);
    return found ? copy(found) : null;
  }

  eventByCode(code: string): DosugEvent | null {
    const id = this.eventIdByCode.get(code);
    return id === undefined ? null : this.event(id);
  }

  participants(): Participant[] {
    return [...this.participantByKey.values()].map(copy);
  }

  participant(eventId: string, userId: number): Participant | null {
    const found = this.participantByKey.get(participantKey(eventId, userId));
    return found ? copy(found) : null;
  }

  items(): EventItem[] {
    return [...this.itemById.values()].map(copy);
  }

  item(id: string): EventItem | null {
    const found = this.itemById.get(id);
    return found ? copy(found) : null;
  }

  reservations(): Reservation[] {
    return [...this.reservationByItemId.values()].map(copy);
  }

  reservation(itemId: string): Reservation | null {
    const found = this.reservationByItemId.get(itemId);
    return found ? copy(found) : null;
  }

  templates(): Template[] {
    return [...this.templateById.values()].map(copy);
  }

  template(id: string): Template | null {
    const found = this.templateById.get(id);
    return found ? copy(found) : null;
  }



  users(): StoredUserProfile[] {
    return [...this.userById.values()].map(copy);
  }

  user(userId: number): StoredUserProfile | null {
    const found = this.userById.get(userId);
    return found ? copy(found) : null;
  }

  // --- точечная запись: «зеркало» базы и операции репозиториев ---

  /** Кладёт событие по id, поддерживая индекс по коду. */
  putEvent(event: DosugEvent): void {
    const previous = this.eventById.get(event.id);
    if (previous && previous.code !== event.code) this.eventIdByCode.delete(previous.code);
    const stored = copy(event);
    this.eventById.set(stored.id, stored);
    this.eventIdByCode.set(stored.code, stored.id);
  }

  /** Кладёт участника по ключу (eventId, userId), id сохраняется как есть. */
  putParticipant(participant: Participant): void {
    const key = participantKey(participant.eventId, participant.userId);
    // Сущность снова в памяти — значит, удалять её в базе больше не нужно.
    this.deletedParticipantByKey.delete(key);
    this.participantByKey.set(key, copy(participant));
  }

  /** Кладёт позицию вместе с бронью; `reservation: null` снимает бронь. */
  putItem(item: ItemWithReservation): void {
    const { reservation, ...rest } = item;
    this.deletedItemIds.delete(rest.id);
    this.itemById.set(rest.id, copy(rest));
    if (reservation === null || reservation === undefined) this.reservationByItemId.delete(rest.id);
    else {
      this.deletedReservationIds.delete(rest.id);
      this.reservationByItemId.set(rest.id, copy(reservation));
    }
  }

  putTemplate(template: Template): void {
    this.deletedTemplateIds.delete(template.id);
    this.templateById.set(template.id, copy(template));
  }

  /** Кладёт профиль по userId, сохраняя даты создания и обновления. */
  putUser(profile: UserProfile & Partial<Pick<StoredUserProfile, 'createdAt' | 'updatedAt'>>): void {
    const previous = this.userById.get(profile.userId);
    const raw = profile as Partial<StoredUserProfile>;
    const now = new Date().toISOString();
    const stored: StoredUserProfile = {
      userId: profile.userId,
      name: profile.name,
      username: profile.username ?? null,
      contact: profile.contact,
      createdAt: raw.createdAt ?? previous?.createdAt ?? now,
      updatedAt: raw.updatedAt ?? previous?.updatedAt ?? now,
    };
    this.userById.set(stored.userId, stored);
  }

  // --- удаление ---

  deleteParticipant(eventId: string, userId: number): boolean {
    const key = participantKey(eventId, userId);
    const removed = this.participantByKey.delete(key);
    // Запоминаем удаление: связь может пропасть раньше, чем оно доедет до базы.
    if (removed) this.deletedParticipantByKey.set(key, { eventId, userId });
    return removed;
  }

  deleteReservation(itemId: string): boolean {
    const removed = this.reservationByItemId.delete(itemId);
    if (removed) this.deletedReservationIds.add(itemId);
    return removed;
  }

  /** Снимает все брони пользователя в событии (DELETE ... WHERE event_id AND user_id). */
  deleteReservations(eventId: string, userId: number): number {
    let removed = 0;
    for (const reservation of this.reservationByItemId.values()) {
      if (reservation.eventId === eventId && reservation.userId === userId) {
        this.reservationByItemId.delete(reservation.itemId);
        this.deletedReservationIds.add(reservation.itemId);
        removed += 1;
      }
    }
    return removed;
  }

  /** Удаляет позицию вместе с бронью — как ON DELETE CASCADE в БД. */
  deleteItem(itemId: string): boolean {
    const existed = this.itemById.delete(itemId);
    this.reservationByItemId.delete(itemId);
    if (existed) this.deletedItemIds.add(itemId);
    return existed;
  }

  deleteTemplate(id: string): boolean {
    const removed = this.templateById.delete(id);
    if (removed) this.deletedTemplateIds.add(id);
    return removed;
  }

  // --- удаления для синхронизации ---

  /** Удаления, которые ещё нужно применить в базе. */
  pendingDeletions(): MemoryDeletions {
    return {
      participants: [...this.deletedParticipantByKey.values()].map(copy),
      items: [...this.deletedItemIds],
      reservations: [...this.deletedReservationIds],
      templates: [...this.deletedTemplateIds],
    };
  }

  /** Сколько удалений ждёт переноса: по ним синхронизация тоже нужна. */
  pendingDeletionCount(): number {
    return this.deletedParticipantByKey.size
      + this.deletedItemIds.size
      + this.deletedReservationIds.size
      + this.deletedTemplateIds.size;
  }

  /** Забыть применённые удаления: вызывается после успешного переноса в базу. */
  clearDeletions(): void {
    this.deletedParticipantByKey.clear();
    this.deletedItemIds.clear();
    this.deletedReservationIds.clear();
    this.deletedTemplateIds.clear();
  }

  // --- снимок состояния ---

  /** Снимок для синхронизации в PostgreSQL и сохранения на диск. */
  snapshot(): MemorySnapshot {
    return {
      version: MEMORY_SNAPSHOT_VERSION,
      events: this.events(),
      participants: this.participants(),
      items: this.items(),
      reservations: this.reservations(),
      templates: this.templates(),
      users: this.users(),
      deletions: this.pendingDeletions(),
    };
  }

  /** Загружает снимок вместо текущего состояния и перестраивает все индексы. */
  restore(snapshot: MemorySnapshot): void {
    this.clear();
    const reservations = new Map(
      snapshotList(snapshot.reservations).map((reservation) => [reservation.itemId, reservation]),
    );
    for (const event of snapshotList(snapshot.events)) this.putEvent(event);
    for (const participant of snapshotList(snapshot.participants)) this.putParticipant(participant);
    for (const item of snapshotList(snapshot.items)) {
      this.putItem({ ...item, reservation: reservations.get(item.id) ?? null });
    }
    for (const template of snapshotList(snapshot.templates)) this.putTemplate(template);
    for (const user of snapshotList(snapshot.users)) this.putUser(user);

    // Удаления загружаем последними: снимок мог быть создан версией без них,
    // а `put*` выше снимает надгробия у тех сущностей, что снова появились.
    const deletions = snapshot.deletions ?? emptyDeletions();
    for (const participant of snapshotList(deletions.participants)) {
      this.deletedParticipantByKey.set(
        participantKey(participant.eventId, participant.userId),
        participant,
      );
    }
    for (const itemId of snapshotList(deletions.items)) this.deletedItemIds.add(itemId);
    for (const itemId of snapshotList(deletions.reservations)) this.deletedReservationIds.add(itemId);
    for (const templateId of snapshotList(deletions.templates)) this.deletedTemplateIds.add(templateId);
  }

  isEmpty(): boolean {
    return (
      this.eventById.size === 0 &&
      this.participantByKey.size === 0 &&
      this.itemById.size === 0 &&
      this.reservationByItemId.size === 0 &&
      this.templateById.size === 0 &&
      this.userById.size === 0 &&
      this.pendingDeletionCount() === 0
    );
  }

  /** Размеры коллекций — для логов и /health. */
  counts(): {
    events: number;
    participants: number;
    items: number;
    reservations: number;
    templates: number;
    users: number;
  } {
    return {
      events: this.eventById.size,
      participants: this.participantByKey.size,
      items: this.itemById.size,
      reservations: this.reservationByItemId.size,
      templates: this.templateById.size,
      users: this.userById.size,
    };
  }

  clear(): void {
    this.eventById.clear();
    this.eventIdByCode.clear();
    this.participantByKey.clear();
    this.itemById.clear();
    this.reservationByItemId.clear();
    this.templateById.clear();
    this.userById.clear();
    this.clearDeletions();
  }
}
