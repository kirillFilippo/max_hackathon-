import type {
  AnswerMode,
  DosugEvent,
  EventField,
  EventStatus,
  ItemWithReservation,
  Participant,
  ParticipantStatus,
  Template,
  UserProfile,
} from '../../domain/types.js';

/**
 * Контракты хранилища: единственное, что видят сервисы.
 *
 * Реализаций две — PostgreSQL (`../repositories/*Repo.ts`) и память
 * (`../memory/*`), поэтому сервисы не знают, где именно лежат данные.
 * Это же разделение даёт работу без БД: при недоступности PostgreSQL
 * запросы обслуживает память, а состояние синхронизируется позже.
 */

export interface CreateEventRecord {
  title: string;
  description: string;
  startsAt: string;
  place: string;
  placeCoords: { lat: number; lon: number } | null;
  limit: number | null;
  fields: EventField[];
  answerMode?: AnswerMode;
  organizerId: number;
  organizerName: string;
}

export interface EventPatch {
  title?: string;
  description?: string;
  startsAt?: string;
  place?: string;
  placeCoords?: { lat: number; lon: number } | null;
  limit?: number | null;
  fields?: EventField[];
  answerMode?: AnswerMode;
  status?: EventStatus;
  closedAt?: string | null;
}

export interface EventsRepository {
  /**
   * Критическая секция по событию: пока одна операция считает состав или нумерует
   * позиции, вторая ждёт. Нужна там, где решение зависит от предварительного чтения
   * (лимит мест, лист ожидания, номер позиции в списке покупок), а сама база такой
   * инвариант не держит. Вложенные вызовы недопустимы — это взаимная блокировка.
   */
  withLock<T>(eventId: string, work: () => Promise<T>): Promise<T>;
  create(input: CreateEventRecord, attempts?: number): Promise<DosugEvent>;
  findById(id: string): Promise<DosugEvent | null>;
  findByCode(code: string): Promise<DosugEvent | null>;
  listByOrganizer(organizerId: number): Promise<DosugEvent[]>;
  listPublished(): Promise<DosugEvent[]>;
  update(id: string, patch: EventPatch): Promise<DosugEvent | null>;
  closeStartedBefore(threshold: Date): Promise<DosugEvent[]>;
  listForUser(userId: number): Promise<DosugEvent[]>;
}

export interface ReserveResult {
  reserved: ItemWithReservation | null;
  /** Имя того, кто уже занял позицию (если заняли не мы). */
  takenBy: string | null;
  /** true, если позиция уже была забронирована этим же пользователем. */
  alreadyMine: boolean;
}

export interface ItemsRepository {
  addMany(eventId: string, titles: string[]): Promise<ItemWithReservation[]>;
  listByEvent(eventId: string): Promise<ItemWithReservation[]>;
  findById(itemId: string): Promise<ItemWithReservation | null>;
  listReservedByUser(eventId: string, userId: number): Promise<ItemWithReservation[]>;
  reserve(itemId: string, eventId: string, userId: number, userName: string): Promise<ReserveResult>;
  release(itemId: string, userId: number): Promise<boolean>;
  releaseAllForUser(eventId: string, userId: number): Promise<number>;
  deleteItem(itemId: string): Promise<boolean>;
}

export interface SaveParticipantInput {
  eventId: string;
  userId: number;
  name: string;
  username: string | null;
  contact: string;
  status: ParticipantStatus;
  answers: Record<string, string>;
  waitlisted: boolean;
}

export interface ParticipantPatch {
  name?: string;
  username?: string | null;
  contact?: string;
  status?: ParticipantStatus;
  answers?: Record<string, string>;
  waitlisted?: boolean;
  confirmSentAt?: string | null;
  finalSentAt?: string | null;
}

export interface ParticipantsRepository {
  upsert(input: SaveParticipantInput): Promise<Participant>;
  patch(eventId: string, userId: number, patch: ParticipantPatch): Promise<Participant | null>;
  find(eventId: string, userId: number): Promise<Participant | null>;
  listByEvent(eventId: string): Promise<Participant[]>;
  listByUser(userId: number): Promise<Participant[]>;
  delete(eventId: string, userId: number): Promise<boolean>;
}

export interface TemplatesRepository {
  listByOwner(ownerId: number): Promise<Template[]>;
  find(id: string): Promise<Template | null>;
  create(ownerId: number, name: string, fields: EventField[]): Promise<Template>;
  rename(id: string, ownerId: number, name: string): Promise<Template | null>;
  updateFields(id: string, ownerId: number, fields: EventField[]): Promise<Template | null>;
  delete(id: string, ownerId: number): Promise<boolean>;
}

export interface UserPatch {
  name?: string;
  username?: string | null;
  contact?: string;
}

export interface UsersRepository {
  ensure(userId: number, patch?: UserPatch): Promise<UserProfile>;
  find(userId: number): Promise<UserProfile | null>;
  saveContact(userId: number, contact: string): Promise<UserProfile>;
  createdAt(userId: number): Promise<string | null>;
}

/** Набор репозиториев — единственная точка доступа сервисов к данным. */
export interface Repositories {
  users: UsersRepository;
  events: EventsRepository;
  items: ItemsRepository;
  participants: ParticipantsRepository;
  templates: TemplatesRepository;
}
