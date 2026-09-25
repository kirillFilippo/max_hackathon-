import type {
  DosugEvent,
  EventItem,
  ItemWithReservation,
  Participant,
  Reservation,
  Template,
  TransferRequest,
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

/** Снимок состояния: только обычные объекты и массивы — годится для JSON и БД. */
export interface MemorySnapshot {
  version: number;
  events: DosugEvent[];
  participants: Participant[];
  items: EventItem[];
  reservations: Reservation[];
  templates: Template[];
  transfers: TransferRequest[];
  users: StoredUserProfile[];
}

/** Копия сущности: хранилище не делится внутренними ссылками с вызывающим кодом. */
const copy = <T>(value: T): T => structuredClone(value);

/** Ключ участника: в БД это UNIQUE (event_id, user_id). */
const participantKey = (eventId: string, userId: number): string => `${eventId}\u0000${userId}`;

/** Ключ расчёта: в БД это UNIQUE (event_id, from_user_id, to_user_id). */
const transferPairKey = (eventId: string, fromUserId: number, toUserId: number): string =>
  `${eventId}\u0000${fromUserId}\u0000${toUserId}`;

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
  private readonly transferById = new Map<string, TransferRequest>();
  private readonly transferIdByPair = new Map<string, string>();
  private readonly userById = new Map<number, StoredUserProfile>();

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

  transfers(): TransferRequest[] {
    return [...this.transferById.values()].map(copy);
  }

  transfer(id: string): TransferRequest | null {
    const found = this.transferById.get(id);
    return found ? copy(found) : null;
  }

  transferPair(eventId: string, fromUserId: number, toUserId: number): TransferRequest | null {
    const id = this.transferIdByPair.get(transferPairKey(eventId, fromUserId, toUserId));
    return id === undefined ? null : this.transfer(id);
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
    this.participantByKey.set(participantKey(participant.eventId, participant.userId), copy(participant));
  }

  /** Кладёт позицию вместе с бронью; `reservation: null` снимает бронь. */
  putItem(item: ItemWithReservation): void {
    const { reservation, ...rest } = item;
    this.itemById.set(rest.id, copy(rest));
    if (reservation === null || reservation === undefined) this.reservationByItemId.delete(rest.id);
    else this.reservationByItemId.set(rest.id, copy(reservation));
  }

  /** Кладёт бронь по ключу item_id. */
  putReservation(reservation: Reservation): void {
    this.reservationByItemId.set(reservation.itemId, copy(reservation));
  }

  putTemplate(template: Template): void {
    this.templateById.set(template.id, copy(template));
  }

  /** Кладёт расчёт по id, поддерживая ключ пары (eventId, fromUserId, toUserId). */
  putTransfer(transfer: TransferRequest): void {
    const key = transferPairKey(transfer.eventId, transfer.fromUserId, transfer.toUserId);
    const previous = this.transferById.get(transfer.id);
    if (previous) {
      const previousKey = transferPairKey(previous.eventId, previous.fromUserId, previous.toUserId);
      if (previousKey !== key && this.transferIdByPair.get(previousKey) === transfer.id) {
        this.transferIdByPair.delete(previousKey);
      }
    }
    // Пара уникальна: запись с другим id на той же паре уступает место новой.
    const pairOwnerId = this.transferIdByPair.get(key);
    if (pairOwnerId !== undefined && pairOwnerId !== transfer.id) this.transferById.delete(pairOwnerId);

    const stored = copy(transfer);
    this.transferById.set(stored.id, stored);
    this.transferIdByPair.set(key, stored.id);
  }

  /** Кладёт профиль по userId, сохраняя даты создания и обновления. */
  putUser(profile: UserProfile): void {
    const previous = this.userById.get(profile.userId);
    const raw = profile as Partial<StoredUserProfile>;
    const now = new Date().toISOString();
    const stored: StoredUserProfile = {
      userId: profile.userId,
      name: profile.name,
      username: profile.username ?? null,
      contact: profile.contact,
      bankName: profile.bankName,
      paymentHandle: profile.paymentHandle,
      createdAt: raw.createdAt ?? previous?.createdAt ?? now,
      updatedAt: raw.updatedAt ?? previous?.updatedAt ?? now,
    };
    this.userById.set(stored.userId, stored);
  }

  // --- удаление ---

  deleteParticipant(eventId: string, userId: number): boolean {
    return this.participantByKey.delete(participantKey(eventId, userId));
  }

  deleteReservation(itemId: string): boolean {
    return this.reservationByItemId.delete(itemId);
  }

  /** Снимает все брони пользователя в событии (DELETE ... WHERE event_id AND user_id). */
  deleteReservations(eventId: string, userId: number): number {
    let removed = 0;
    for (const reservation of this.reservationByItemId.values()) {
      if (reservation.eventId === eventId && reservation.userId === userId) {
        this.reservationByItemId.delete(reservation.itemId);
        removed += 1;
      }
    }
    return removed;
  }

  /** Удаляет позицию вместе с бронью — как ON DELETE CASCADE в БД. */
  deleteItem(itemId: string): boolean {
    const existed = this.itemById.delete(itemId);
    this.reservationByItemId.delete(itemId);
    return existed;
  }

  deleteTemplate(id: string): boolean {
    return this.templateById.delete(id);
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
      transfers: this.transfers(),
      users: this.users(),
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
    for (const transfer of snapshotList(snapshot.transfers)) this.putTransfer(transfer);
    for (const user of snapshotList(snapshot.users)) this.putUser(user);
  }

  isEmpty(): boolean {
    return (
      this.eventById.size === 0 &&
      this.participantByKey.size === 0 &&
      this.itemById.size === 0 &&
      this.reservationByItemId.size === 0 &&
      this.templateById.size === 0 &&
      this.transferById.size === 0 &&
      this.userById.size === 0
    );
  }

  /** Размеры коллекций — для логов и /health. */
  counts(): {
    events: number;
    participants: number;
    items: number;
    templates: number;
    transfers: number;
    users: number;
  } {
    return {
      events: this.eventById.size,
      participants: this.participantByKey.size,
      items: this.itemById.size,
      templates: this.templateById.size,
      transfers: this.transferById.size,
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
    this.transferById.clear();
    this.transferIdByPair.clear();
    this.userById.clear();
  }
}
