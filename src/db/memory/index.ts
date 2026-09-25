import { newEventCode, newEventId, newItemId, newParticipantId, newTemplateId, newTransferId } from '../../domain/ids.js';
import { normalizeFields } from '../../domain/questionnaire.js';
import type {
  DosugEvent,
  EventField,
  EventItem,
  ItemWithReservation,
  Participant,
  Reservation,
  Template,
  TransferRequest,
  UserProfile,
} from '../../domain/types.js';
import { toIso, toIsoOrNull, toNumberOrNull } from '../mappers.js';
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
  TransferPatch,
  TransfersRepository,
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

/** Текущее время в том же виде, в каком его отдаёт PostgreSQL — ISO-строка UTC. */
const nowIso = (): string => new Date().toISOString();

/**
 * Сортировка по ISO-времени. При равных значениях порядок сохраняется
 * (сортировка в JS стабильна), поэтому результат воспроизводим.
 */
const sortByTime = <T>(items: T[], pick: (item: T) => string, order: 'asc' | 'desc' = 'asc'): T[] => {
  const sign = order === 'asc' ? 1 : -1;
  return items.sort((a, b) => sign * (Date.parse(pick(a)) - Date.parse(pick(b))));
};

/** Приводит событие к доменному виду так же, как `mapEvent` в SQL-репозитории. */
const mapEvent = (event: DosugEvent): DosugEvent => ({
  ...event,
  placeCoords: event.placeCoords
    ? { lat: Number(event.placeCoords.lat), lon: Number(event.placeCoords.lon) }
    : null,
  limit: toNumberOrNull(event.limit),
  fields: normalizeFields(event.fields),
  answerMode: event.answerMode ?? 'auto',
});

const mapParticipant = (participant: Participant): Participant => ({
  ...participant,
  username: participant.username ?? null,
  answers: { ...(participant.answers ?? {}) },
  waitlisted: participant.waitlisted ?? false,
  confirmSentAt: toIsoOrNull(participant.confirmSentAt),
  finalSentAt: toIsoOrNull(participant.finalSentAt),
});

/** Собирает позицию списка покупок вместе с бронью — как LEFT JOIN в SQL. */
const mapItem = (item: EventItem, reservation: Reservation | null): ItemWithReservation => ({
  id: item.id,
  eventId: item.eventId,
  title: item.title,
  position: toNumberOrNull(item.position) ?? 0,
  createdAt: toIso(item.createdAt),
  reservation: reservation
    ? {
        itemId: item.id,
        eventId: reservation.eventId ?? item.eventId,
        userId: reservation.userId,
        userName: reservation.userName ?? '',
        reservedAt: toIso(reservation.reservedAt ?? item.createdAt),
        paidKopecks: toNumberOrNull(reservation.paidKopecks),
        paidAt: toIsoOrNull(reservation.paidAt),
        note: reservation.note ?? '',
      }
    : null,
});

const mapTemplate = (template: Template): Template => ({
  id: template.id,
  name: template.name,
  fields: Array.isArray(template.fields) ? [...template.fields] : [],
  // Предустановленные шаблоны живут в коде, в памяти лежат только свои.
  builtin: false,
  ownerId: template.ownerId ?? null,
  createdAt: toIso(template.createdAt),
});

const mapTransfer = (transfer: TransferRequest): TransferRequest => ({
  ...transfer,
  amountKopecks: Number(transfer.amountKopecks),
  notifiedAt: toIsoOrNull(transfer.notifiedAt),
  detailsSentAt: toIsoOrNull(transfer.detailsSentAt),
  paidAt: toIsoOrNull(transfer.paidAt),
  closedAt: toIsoOrNull(transfer.closedAt),
});

const mapUser = (user: StoredUserProfile): UserProfile => ({
  userId: user.userId,
  name: user.name,
  username: user.username ?? null,
  contact: user.contact,
  bankName: user.bankName,
  paymentHandle: user.paymentHandle,
});

export class MemoryEventsRepository implements EventsRepository {
  constructor(private readonly store: MemoryStore) {}

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

export class MemoryParticipantsRepository implements ParticipantsRepository {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Пишет участника по ключу (eventId, userId). Ответы при повторной записи
   * сливаются со старыми (`answers || EXCLUDED.answers` в SQL), остальные поля
   * перезаписываются, дата создания сохраняется.
   */
  async upsert(input: SaveParticipantInput): Promise<Participant> {
    const current = this.store.participant(input.eventId, input.userId);
    const now = nowIso();
    const participant: Participant = current
      ? {
          ...current,
          name: input.name,
          username: input.username,
          contact: input.contact,
          status: input.status,
          // Как и в базе: ответы заменяются целиком (слияние не даёт очистить ответ).
          answers: { ...input.answers },
          waitlisted: input.waitlisted,
          updatedAt: now,
        }
      : {
          id: newParticipantId(),
          eventId: input.eventId,
          userId: input.userId,
          name: input.name,
          username: input.username,
          contact: input.contact,
          status: input.status,
          answers: { ...input.answers },
          waitlisted: input.waitlisted,
          confirmSentAt: null,
          finalSentAt: null,
          createdAt: now,
          updatedAt: now,
        };
    this.store.putParticipant(participant);
    return mapParticipant(participant);
  }

  /** Патч применяет только переданные поля; `answers` заменяет ответы целиком. */
  async patch(eventId: string, userId: number, patch: ParticipantPatch): Promise<Participant | null> {
    const current = this.store.participant(eventId, userId);
    if (!current) return null;

    const changed =
      patch.name !== undefined ||
      patch.username !== undefined ||
      patch.contact !== undefined ||
      patch.status !== undefined ||
      patch.answers !== undefined ||
      patch.waitlisted !== undefined ||
      patch.confirmSentAt !== undefined ||
      patch.finalSentAt !== undefined;
    if (!changed) return mapParticipant(current);

    const updated: Participant = { ...current, updatedAt: nowIso() };
    if (patch.name !== undefined) updated.name = patch.name;
    if (patch.username !== undefined) updated.username = patch.username;
    if (patch.contact !== undefined) updated.contact = patch.contact;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.answers !== undefined) updated.answers = { ...patch.answers };
    if (patch.waitlisted !== undefined) updated.waitlisted = patch.waitlisted;
    if (patch.confirmSentAt !== undefined) updated.confirmSentAt = patch.confirmSentAt;
    if (patch.finalSentAt !== undefined) updated.finalSentAt = patch.finalSentAt;

    this.store.putParticipant(updated);
    return mapParticipant(updated);
  }

  async find(eventId: string, userId: number): Promise<Participant | null> {
    const participant = this.store.participant(eventId, userId);
    return participant ? mapParticipant(participant) : null;
  }

  async listByEvent(eventId: string): Promise<Participant[]> {
    const participants = this.store
      .participants()
      .filter((participant) => participant.eventId === eventId)
      .map(mapParticipant);
    return sortByTime(participants, (participant) => participant.createdAt);
  }

  async listByUser(userId: number): Promise<Participant[]> {
    const participants = this.store
      .participants()
      .filter((participant) => participant.userId === userId)
      .map(mapParticipant);
    return sortByTime(participants, (participant) => participant.createdAt, 'desc');
  }

  async delete(eventId: string, userId: number): Promise<boolean> {
    return this.store.deleteParticipant(eventId, userId);
  }
}

export class MemoryItemsRepository implements ItemsRepository {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Добавляет позиции: заголовки обрезаются до 160 символов, пустые строки
   * пропускаются, нумерация продолжается с текущего максимума. Возвращается
   * список события целиком — как в SQL-репозитории.
   */
  async addMany(eventId: string, titles: string[]): Promise<ItemWithReservation[]> {
    const clean = titles
      .map((title) => title.trim().slice(0, 160))
      .filter((title) => title.length > 0);
    if (clean.length === 0) return [];

    const positions = this.store
      .items()
      .filter((item) => item.eventId === eventId)
      .map((item) => toNumberOrNull(item.position) ?? 0);
    let position = (positions.length > 0 ? Math.max(...positions) : 0) + 1;

    for (const title of clean) {
      const item: EventItem = {
        id: newItemId(),
        eventId,
        title,
        position,
        createdAt: nowIso(),
      };
      this.store.putItem({ ...item, reservation: null });
      position += 1;
    }
    return this.listByEvent(eventId);
  }

  async listByEvent(eventId: string): Promise<ItemWithReservation[]> {
    const reservations = new Map(
      this.store.reservations().map((reservation) => [reservation.itemId, reservation]),
    );
    const items = this.store
      .items()
      .filter((item) => item.eventId === eventId)
      .map((item) => mapItem(item, reservations.get(item.id) ?? null));
    return items.sort(
      (a, b) => a.position - b.position || Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  }

  async findById(itemId: string): Promise<ItemWithReservation | null> {
    const item = this.store.item(itemId);
    return item ? mapItem(item, this.store.reservation(itemId)) : null;
  }

  async listReservedByUser(eventId: string, userId: number): Promise<ItemWithReservation[]> {
    const items = await this.listByEvent(eventId);
    return items
      .filter((item) => item.reservation?.userId === userId)
      .sort((a, b) => a.position - b.position);
  }

  /**
   * Бронирует позицию. Проверка и вставка идут без `await`, поэтому в одном
   * потоке бронь эксклюзивна: второй пользователь получит имя занявшего.
   */
  async reserve(
    itemId: string,
    eventId: string,
    userId: number,
    userName: string,
  ): Promise<ReserveResult> {
    const item = this.store.item(itemId);
    // Позиции нет — бронировать нечего (в БД это была бы ошибка внешнего ключа).
    if (!item) return { reserved: null, takenBy: null, alreadyMine: false };

    const existing = this.store.reservation(itemId);
    if (existing) {
      const mine = existing.userId === userId;
      // takenBy — имя того, кто занял позицию; для своей брони его не показываем.
      return { reserved: null, takenBy: mine ? null : (existing.userName ?? ''), alreadyMine: mine };
    }

    const reservation: Reservation = {
      itemId,
      eventId,
      userId,
      userName,
      reservedAt: nowIso(),
      paidKopecks: null,
      paidAt: null,
      note: '',
    };
    this.store.putItem({ ...item, reservation });
    return { reserved: mapItem(item, reservation), takenBy: null, alreadyMine: false };
  }

  async release(itemId: string, userId: number): Promise<boolean> {
    const existing = this.store.reservation(itemId);
    if (!existing || existing.userId !== userId) return false;
    return this.store.deleteReservation(itemId);
  }

  /** Снимает все брони пользователя: нужно при отказе от участия. */
  async releaseAllForUser(eventId: string, userId: number): Promise<number> {
    return this.store.deleteReservations(eventId, userId);
  }

  async setPaidAmount(
    itemId: string,
    userId: number,
    paidKopecks: number | null,
  ): Promise<ItemWithReservation | null> {
    const existing = this.store.reservation(itemId);
    // Чужую бронь править нельзя.
    if (!existing || existing.userId !== userId) return null;

    this.store.putReservation({
      ...existing,
      paidKopecks,
      // SQL: CASE WHEN сумма IS NULL THEN NULL ELSE now() END.
      paidAt: paidKopecks === null ? null : nowIso(),
    });
    return this.findById(itemId);
  }

  async deleteItem(itemId: string): Promise<boolean> {
    return this.store.deleteItem(itemId);
  }
}

export class MemoryTemplatesRepository implements TemplatesRepository {
  constructor(private readonly store: MemoryStore) {}

  async listByOwner(ownerId: number): Promise<Template[]> {
    const templates = this.store
      .templates()
      .filter((template) => template.ownerId === ownerId)
      .map(mapTemplate);
    return sortByTime(templates, (template) => template.createdAt);
  }

  async find(id: string): Promise<Template | null> {
    const template = this.store.template(id);
    return template ? mapTemplate(template) : null;
  }

  async create(ownerId: number, name: string, fields: EventField[]): Promise<Template> {
    const template: Template = {
      id: newTemplateId(),
      name,
      fields: [...fields],
      builtin: false,
      ownerId,
      createdAt: nowIso(),
    };
    this.store.putTemplate(template);
    return mapTemplate(template);
  }

  async rename(id: string, ownerId: number, name: string): Promise<Template | null> {
    const current = this.store.template(id);
    if (!current || current.ownerId !== ownerId) return null;
    const updated: Template = { ...current, name };
    this.store.putTemplate(updated);
    return mapTemplate(updated);
  }

  async updateFields(id: string, ownerId: number, fields: EventField[]): Promise<Template | null> {
    const current = this.store.template(id);
    if (!current || current.ownerId !== ownerId) return null;
    const updated: Template = { ...current, fields: [...fields] };
    this.store.putTemplate(updated);
    return mapTemplate(updated);
  }

  async delete(id: string, ownerId: number): Promise<boolean> {
    const current = this.store.template(id);
    if (!current || current.ownerId !== ownerId) return false;
    return this.store.deleteTemplate(id);
  }
}

export class MemoryTransfersRepository implements TransfersRepository {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Пишет расчёты по ключу (eventId, fromUserId, toUserId). У существующего
   * запроса обновляется только сумма: статус, способ и даты уже начатой
   * передачи не сбрасываются.
   */
  async upsertMany(
    eventId: string,
    transfers: Array<{ fromUserId: number; toUserId: number; amountKopecks: number }>,
  ): Promise<TransferRequest[]> {
    if (transfers.length === 0) return [];

    const result: TransferRequest[] = [];
    for (const transfer of transfers) {
      const current = this.store.transferPair(eventId, transfer.fromUserId, transfer.toUserId);
      const now = nowIso();
      const record: TransferRequest = current
        ? { ...current, amountKopecks: transfer.amountKopecks, updatedAt: now }
        : {
            id: newTransferId(),
            eventId,
            fromUserId: transfer.fromUserId,
            toUserId: transfer.toUserId,
            amountKopecks: transfer.amountKopecks,
            mode: 'unset',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            notifiedAt: null,
            detailsSentAt: null,
            paidAt: null,
            closedAt: null,
          };
      this.store.putTransfer(record);
      result.push(mapTransfer(record));
    }
    return result;
  }

  async listByEvent(eventId: string): Promise<TransferRequest[]> {
    const transfers = this.store
      .transfers()
      .filter((transfer) => transfer.eventId === eventId)
      .map(mapTransfer);
    return sortByTime(transfers, (transfer) => transfer.createdAt);
  }

  async findById(id: string): Promise<TransferRequest | null> {
    const transfer = this.store.transfer(id);
    return transfer ? mapTransfer(transfer) : null;
  }

  async findPair(
    eventId: string,
    fromUserId: number,
    toUserId: number,
  ): Promise<TransferRequest | null> {
    const transfer = this.store.transferPair(eventId, fromUserId, toUserId);
    return transfer ? mapTransfer(transfer) : null;
  }

  /** Закрытые расчёты в списки долгов не попадают. */
  async listForDebtor(userId: number): Promise<TransferRequest[]> {
    const transfers = this.store
      .transfers()
      .filter((transfer) => transfer.fromUserId === userId && transfer.status !== 'closed')
      .map(mapTransfer);
    return sortByTime(transfers, (transfer) => transfer.createdAt);
  }

  async listForCreditor(userId: number): Promise<TransferRequest[]> {
    const transfers = this.store
      .transfers()
      .filter((transfer) => transfer.toUserId === userId && transfer.status !== 'closed')
      .map(mapTransfer);
    return sortByTime(transfers, (transfer) => transfer.createdAt);
  }

  async patch(id: string, patch: TransferPatch): Promise<TransferRequest | null> {
    const current = this.store.transfer(id);
    if (!current) return null;

    const changed =
      patch.amountKopecks !== undefined ||
      patch.mode !== undefined ||
      patch.status !== undefined ||
      patch.notifiedAt !== undefined ||
      patch.detailsSentAt !== undefined ||
      patch.paidAt !== undefined ||
      patch.closedAt !== undefined;
    if (!changed) return mapTransfer(current);

    const updated: TransferRequest = { ...current, updatedAt: nowIso() };
    if (patch.amountKopecks !== undefined) updated.amountKopecks = patch.amountKopecks;
    if (patch.mode !== undefined) updated.mode = patch.mode;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.notifiedAt !== undefined) updated.notifiedAt = patch.notifiedAt;
    if (patch.detailsSentAt !== undefined) updated.detailsSentAt = patch.detailsSentAt;
    if (patch.paidAt !== undefined) updated.paidAt = patch.paidAt;
    if (patch.closedAt !== undefined) updated.closedAt = patch.closedAt;

    this.store.putTransfer(updated);
    return mapTransfer(updated);
  }
}

export class MemoryUsersRepository implements UsersRepository {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Создаёт профиль при отсутствии. При повторе непустые имя и контакт
   * заменяют сохранённые, пустые — нет; username перезаписывается, если он
   * передан не null (как COALESCE в SQL).
   */
  async ensure(userId: number, patch: UserPatch = {}): Promise<UserProfile> {
    const current = this.store.user(userId);
    const now = nowIso();
    const name = patch.name ?? '';
    const username = patch.username ?? null;
    const contact = patch.contact ?? '';

    const record: StoredUserProfile = current
      ? {
          ...current,
          name: name !== '' ? name : current.name,
          username: username ?? current.username,
          contact: contact !== '' ? contact : current.contact,
          updatedAt: now,
        }
      : {
          userId,
          name,
          username,
          contact,
          bankName: '',
          paymentHandle: '',
          createdAt: now,
          updatedAt: now,
        };
    this.store.putUser(record);
    return mapUser(record);
  }

  async find(userId: number): Promise<UserProfile | null> {
    const user = this.store.user(userId);
    return user ? mapUser(user) : null;
  }

  async saveContact(userId: number, contact: string): Promise<UserProfile> {
    const current = this.store.user(userId);
    const now = nowIso();
    const record: StoredUserProfile = current
      ? { ...current, contact, updatedAt: now }
      : {
          userId,
          name: '',
          username: null,
          contact,
          bankName: '',
          paymentHandle: '',
          createdAt: now,
          updatedAt: now,
        };
    this.store.putUser(record);
    return mapUser(record);
  }

  async savePaymentDetails(
    userId: number,
    bankName: string,
    paymentHandle: string,
  ): Promise<UserProfile> {
    const current = this.store.user(userId);
    const now = nowIso();
    const record: StoredUserProfile = current
      ? { ...current, bankName, paymentHandle, updatedAt: now }
      : {
          userId,
          name: '',
          username: null,
          contact: '',
          bankName,
          paymentHandle,
          createdAt: now,
          updatedAt: now,
        };
    this.store.putUser(record);
    return mapUser(record);
  }

  async createdAt(userId: number): Promise<string | null> {
    const user = this.store.user(userId);
    return user ? user.createdAt : null;
  }
}

/**
 * Собирает набор репозиториев в памяти. Хранилище можно передать снаружи —
 * тогда зеркало базы и репозитории работают с одними и теми же данными.
 */
export const createMemoryRepositories = (store: MemoryStore = new MemoryStore()): Repositories => ({
  users: new MemoryUsersRepository(store),
  events: new MemoryEventsRepository(store),
  items: new MemoryItemsRepository(store),
  participants: new MemoryParticipantsRepository(store),
  templates: new MemoryTemplatesRepository(store),
  transfers: new MemoryTransfersRepository(store),
});
