import { newItemId } from '../../domain/ids.js';
import type { EventItem, ItemWithReservation, Reservation } from '../../domain/types.js';
import { toIso, toIsoOrNull, toNumberOrNull } from '../mappers.js';
import type { Db } from '../pool.js';

interface ItemRow {
  id: string;
  event_id: string;
  title: string;
  position: number;
  created_at: Date;
  r_user_id: number | null;
  r_user_name: string | null;
  r_reserved_at: Date | null;
  r_paid_kopecks: number | null;
  r_paid_at: Date | null;
  r_note: string | null;
}

const ITEM_SELECT = `
SELECT i.id, i.event_id, i.title, i.position, i.created_at,
       r.user_id      AS r_user_id,
       r.user_name    AS r_user_name,
       r.reserved_at  AS r_reserved_at,
       r.paid_kopecks AS r_paid_kopecks,
       r.paid_at      AS r_paid_at,
       r.note         AS r_note
FROM event_items i
LEFT JOIN reservations r ON r.item_id = i.id
`;

const mapItem = (row: ItemRow): ItemWithReservation => {
  const item: EventItem = {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    position: row.position,
    createdAt: toIso(row.created_at),
  };
  const reservation: Reservation | null =
    row.r_user_id === null
      ? null
      : {
          itemId: row.id,
          eventId: row.event_id,
          userId: row.r_user_id,
          userName: row.r_user_name ?? '',
          reservedAt: toIso(row.r_reserved_at ?? row.created_at),
          paidKopecks: toNumberOrNull(row.r_paid_kopecks),
          paidAt: toIsoOrNull(row.r_paid_at),
          note: row.r_note ?? '',
        };
  return { ...item, reservation };
};

export interface ReserveResult {
  reserved: ItemWithReservation | null;
  /** Имя того, кто уже занял позицию (если заняли не мы). */
  takenBy: string | null;
  /** true, если позиция уже была забронирована этим же пользователем. */
  alreadyMine: boolean;
}

/**
 * Список покупок: позиции и брони. Одна позиция — одна бронь; конфликт
 * разрешается на уровне БД (reservations.item_id — первичный ключ), поэтому
 * одновременные нажатия не создадут две брони на один предмет.
 */
export class ItemsRepo {
  constructor(private readonly db: Db) {}

  async addMany(eventId: string, titles: string[]): Promise<ItemWithReservation[]> {
    const clean = titles.map((title) => title.trim().slice(0, 160)).filter((title) => title.length > 0);
    if (clean.length === 0) return [];

    await this.db.transaction(async (client) => {
      const maxRow = await client.query<{ max: number | null }>(
        'SELECT MAX(position) AS max FROM event_items WHERE event_id = $1',
        [eventId],
      );
      let position = (toNumberOrNull(maxRow.rows[0]?.max) ?? 0) + 1;
      for (const title of clean) {
        await client.query(
          'INSERT INTO event_items (id, event_id, title, position) VALUES ($1, $2, $3, $4)',
          [newItemId(), eventId, title, position],
        );
        position += 1;
      }
    });

    return this.listByEvent(eventId);
  }

  async listByEvent(eventId: string): Promise<ItemWithReservation[]> {
    const rows = await this.db.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.event_id = $1 ORDER BY i.position ASC, i.created_at ASC`,
      [eventId],
    );
    return rows.rows.map(mapItem);
  }

  async findById(itemId: string): Promise<ItemWithReservation | null> {
    const rows = await this.db.query<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [itemId]);
    return rows.rows[0] ? mapItem(rows.rows[0]) : null;
  }

  async listReservedByUser(eventId: string, userId: number): Promise<ItemWithReservation[]> {
    const rows = await this.db.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.event_id = $1 AND r.user_id = $2 ORDER BY i.position ASC`,
      [eventId, userId],
    );
    return rows.rows.map(mapItem);
  }

  async reserve(
    itemId: string,
    eventId: string,
    userId: number,
    userName: string,
  ): Promise<ReserveResult> {
    const inserted = await this.db.query<{ item_id: string }>(
      `INSERT INTO reservations (item_id, event_id, user_id, user_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_id) DO NOTHING
       RETURNING item_id`,
      [itemId, eventId, userId, userName],
    );

    if (inserted.rows[0]) {
      return { reserved: await this.findById(itemId), takenBy: null, alreadyMine: false };
    }

    const existing = await this.db.query<{ user_id: number; user_name: string }>(
      'SELECT user_id, user_name FROM reservations WHERE item_id = $1',
      [itemId],
    );
    const owner = existing.rows[0];
    return {
      reserved: null,
      takenBy: owner && owner.user_id !== userId ? owner.user_name : null,
      alreadyMine: owner?.user_id === userId,
    };
  }

  async release(itemId: string, userId: number): Promise<boolean> {
    const row = await this.db.query(
      'DELETE FROM reservations WHERE item_id = $1 AND user_id = $2 RETURNING item_id',
      [itemId, userId],
    );
    return row.rowCount === 1;
  }

  /** Снимает все брони пользователя: нужно при отказе от участия. */
  async releaseAllForUser(eventId: string, userId: number): Promise<number> {
    const row = await this.db.query(
      'DELETE FROM reservations WHERE event_id = $1 AND user_id = $2',
      [eventId, userId],
    );
    return row.rowCount ?? 0;
  }

  async setPaidAmount(
    itemId: string,
    userId: number,
    paidKopecks: number | null,
  ): Promise<ItemWithReservation | null> {
    const row = await this.db.query(
      `UPDATE reservations
       SET paid_kopecks = $3, paid_at = CASE WHEN $3::bigint IS NULL THEN NULL ELSE now() END
       WHERE item_id = $1 AND user_id = $2
       RETURNING item_id`,
      [itemId, userId, paidKopecks],
    );
    if (row.rowCount === 0) return null;
    return this.findById(itemId);
  }

  async deleteItem(itemId: string): Promise<boolean> {
    const row = await this.db.query('DELETE FROM event_items WHERE id = $1 RETURNING id', [itemId]);
    return row.rowCount === 1;
  }
}
