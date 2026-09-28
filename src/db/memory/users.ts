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

import { mapUser, nowIso } from './helpers.js';

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
