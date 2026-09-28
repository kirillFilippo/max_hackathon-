import { newItemId } from '../../domain/ids.js';
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
import { toNumberOrNull } from '../mappers.js';
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

import { mapItem, nowIso } from './helpers.js';

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
