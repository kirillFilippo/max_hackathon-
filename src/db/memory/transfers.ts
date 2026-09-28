import { newTransferId } from '../../domain/ids.js';
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

import { mapTransfer, nowIso, sortByTime } from './helpers.js';

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
