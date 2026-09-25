import { newTransferId } from '../../domain/ids.js';
import type { TransferMode, TransferRequest, TransferStatus } from '../../domain/types.js';
import { toIso, toIsoOrNull } from '../mappers.js';
import type { Db } from '../pool.js';
import type { TransferPatch, TransfersRepository } from './contracts.js';

interface TransferRow {
  id: string;
  event_id: string;
  from_user_id: number;
  to_user_id: number;
  amount_kopecks: number;
  mode: TransferMode;
  status: TransferStatus;
  created_at: Date;
  updated_at: Date;
  notified_at: Date | null;
  details_sent_at: Date | null;
  paid_at: Date | null;
  closed_at: Date | null;
}

const mapTransfer = (row: TransferRow): TransferRequest => ({
  id: row.id,
  eventId: row.event_id,
  fromUserId: row.from_user_id,
  toUserId: row.to_user_id,
  amountKopecks: Number(row.amount_kopecks),
  mode: row.mode,
  status: row.status,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  notifiedAt: toIsoOrNull(row.notified_at),
  detailsSentAt: toIsoOrNull(row.details_sent_at),
  paidAt: toIsoOrNull(row.paid_at),
  closedAt: toIsoOrNull(row.closed_at),
});

/** Запросы на расчёт: кто кому сколько должен и на каком этапе передача денег. */
export class TransfersRepo implements TransfersRepository {
  constructor(private readonly db: Db) {}

  /**
   * Создаёт или обновляет запросы по текущему расчёту. Сумма обновляется,
   * статус и способ расчёта уже начатых запросов не сбрасываются.
   */
  async upsertMany(
    eventId: string,
    transfers: Array<{ fromUserId: number; toUserId: number; amountKopecks: number }>,
  ): Promise<TransferRequest[]> {
    if (transfers.length === 0) return [];
    return this.db.transaction(async (client) => {
      const result: TransferRequest[] = [];
      for (const transfer of transfers) {
        const row = await client.query<TransferRow>(
          `INSERT INTO transfer_requests (id, event_id, from_user_id, to_user_id, amount_kopecks)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (event_id, from_user_id, to_user_id) DO UPDATE SET
             amount_kopecks = EXCLUDED.amount_kopecks,
             updated_at     = now()
           RETURNING *`,
          [newTransferId(), eventId, transfer.fromUserId, transfer.toUserId, transfer.amountKopecks],
        );
        result.push(mapTransfer(row.rows[0]!));
      }
      return result;
    });
  }

  async listByEvent(eventId: string): Promise<TransferRequest[]> {
    const rows = await this.db.query<TransferRow>(
      'SELECT * FROM transfer_requests WHERE event_id = $1 ORDER BY created_at ASC',
      [eventId],
    );
    return rows.rows.map(mapTransfer);
  }

  async findById(id: string): Promise<TransferRequest | null> {
    const row = await this.db.query<TransferRow>(
      'SELECT * FROM transfer_requests WHERE id = $1',
      [id],
    );
    return row.rows[0] ? mapTransfer(row.rows[0]) : null;
  }

  async findPair(
    eventId: string,
    fromUserId: number,
    toUserId: number,
  ): Promise<TransferRequest | null> {
    const row = await this.db.query<TransferRow>(
      'SELECT * FROM transfer_requests WHERE event_id = $1 AND from_user_id = $2 AND to_user_id = $3',
      [eventId, fromUserId, toUserId],
    );
    return row.rows[0] ? mapTransfer(row.rows[0]) : null;
  }

  async listForDebtor(userId: number): Promise<TransferRequest[]> {
    const rows = await this.db.query<TransferRow>(
      `SELECT * FROM transfer_requests
       WHERE from_user_id = $1 AND status NOT IN ('closed') ORDER BY created_at ASC`,
      [userId],
    );
    return rows.rows.map(mapTransfer);
  }

  async listForCreditor(userId: number): Promise<TransferRequest[]> {
    const rows = await this.db.query<TransferRow>(
      `SELECT * FROM transfer_requests
       WHERE to_user_id = $1 AND status NOT IN ('closed') ORDER BY created_at ASC`,
      [userId],
    );
    return rows.rows.map(mapTransfer);
  }

  async patch(id: string, patch: TransferPatch): Promise<TransferRequest | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (sql: string, value: unknown): void => {
      values.push(value);
      sets.push(`${sql} = $${values.length}`);
    };

    if (patch.amountKopecks !== undefined) push('amount_kopecks', patch.amountKopecks);
    if (patch.mode !== undefined) push('mode', patch.mode);
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.notifiedAt !== undefined) push('notified_at', patch.notifiedAt);
    if (patch.detailsSentAt !== undefined) push('details_sent_at', patch.detailsSentAt);
    if (patch.paidAt !== undefined) push('paid_at', patch.paidAt);
    if (patch.closedAt !== undefined) push('closed_at', patch.closedAt);

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    const row = await this.db.query<TransferRow>(
      `UPDATE transfer_requests SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return row.rows[0] ? mapTransfer(row.rows[0]) : null;
  }
}
