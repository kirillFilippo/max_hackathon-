import type { Db } from '../pool.js';
import type { MemorySnapshot } from '../memory/store.js';

/**
 * Запись состояния из памяти в PostgreSQL с сохранением идентификаторов.
 *
 * Обычные репозитории сами придумывают id и короткие коды, поэтому для
 * синхронизации они не годятся: событие, созданное в памяти во время обрыва
 * связи, должно приехать в базу с тем же id, кодом и ссылками. Здесь всё
 * пишется напрямую через SQL и идемпотентно: повторный вызов обновляет те же
 * строки, а не создаёт дубли.
 */

/** Приводит ISO-строку к значению для timestamptz (или к null). */
const ts = (value: string | null | undefined): string | null => value ?? null;

export const importSnapshot = async (db: Db, snapshot: MemorySnapshot): Promise<void> => {
  await db.transaction(async (client) => {
    for (const user of snapshot.users) {
      await client.query(
        `INSERT INTO users (user_id, name, username, contact, bank_name, payment_handle, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), now())
         ON CONFLICT (user_id) DO UPDATE SET
           name           = EXCLUDED.name,
           username       = EXCLUDED.username,
           contact        = EXCLUDED.contact,
           bank_name      = EXCLUDED.bank_name,
           payment_handle = EXCLUDED.payment_handle,
           updated_at     = now()`,
        [
          user.userId,
          user.name,
          user.username,
          user.contact,
          user.bankName,
          user.paymentHandle,
          ts(user.createdAt),
        ],
      );
    }

    for (const event of snapshot.events) {
      // Конфликт по коду возможен, если событие создали в памяти с кодом, который
      // уже занят в базе: код уникален, поэтому переносим такое событие с новым кодом.
      const codeRow = await client.query<{ id: string }>(
        'SELECT id FROM events WHERE code = $1',
        [event.code],
      );
      const codeTaken = codeRow.rows[0] !== undefined && codeRow.rows[0].id !== event.id;
      const code = codeTaken ? `${event.code}${Math.floor(Math.random() * 90 + 10)}` : event.code;

      await client.query(
        `INSERT INTO events
           (id, code, title, description, starts_at, place, place_lat, place_lon,
            limit_count, status, organizer_id, organizer_name, fields, answer_mode,
            created_at, updated_at, closed_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14,
                 COALESCE($15::timestamptz, now()), now(), $16::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           title          = EXCLUDED.title,
           description    = EXCLUDED.description,
           starts_at      = EXCLUDED.starts_at,
           place          = EXCLUDED.place,
           place_lat      = EXCLUDED.place_lat,
           place_lon      = EXCLUDED.place_lon,
           limit_count    = EXCLUDED.limit_count,
           status         = EXCLUDED.status,
           organizer_id   = EXCLUDED.organizer_id,
           organizer_name = EXCLUDED.organizer_name,
           fields         = EXCLUDED.fields,
           answer_mode    = EXCLUDED.answer_mode,
           updated_at     = now(),
           closed_at      = EXCLUDED.closed_at`,
        [
          event.id,
          code,
          event.title,
          event.description,
          event.startsAt,
          event.place,
          event.placeCoords?.lat ?? null,
          event.placeCoords?.lon ?? null,
          event.limit,
          event.status,
          event.organizerId,
          event.organizerName,
          JSON.stringify(event.fields),
          event.answerMode,
          ts(event.createdAt),
          ts(event.closedAt),
        ],
      );
    }

    for (const participant of snapshot.participants) {
      await client.query(
        `INSERT INTO participants
           (id, event_id, user_id, name, username, contact, status, answers, waitlisted,
            confirm_sent_at, final_sent_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::timestamptz, $11::timestamptz,
                 COALESCE($12::timestamptz, now()), now())
         ON CONFLICT (event_id, user_id) DO UPDATE SET
           name            = EXCLUDED.name,
           username        = EXCLUDED.username,
           contact         = EXCLUDED.contact,
           status          = EXCLUDED.status,
           answers         = EXCLUDED.answers,
           waitlisted      = EXCLUDED.waitlisted,
           confirm_sent_at = EXCLUDED.confirm_sent_at,
           final_sent_at   = EXCLUDED.final_sent_at,
           updated_at      = now()`,
        [
          participant.id,
          participant.eventId,
          participant.userId,
          participant.name,
          participant.username,
          participant.contact,
          participant.status,
          JSON.stringify(participant.answers),
          participant.waitlisted,
          ts(participant.confirmSentAt),
          ts(participant.finalSentAt),
          ts(participant.createdAt),
        ],
      );
    }

    // Позиции и брони в снимке лежат отдельно — как в базе.
    const reservationByItem = new Map(
      snapshot.reservations.map((reservation) => [reservation.itemId, reservation]),
    );

    for (const item of snapshot.items) {
      await client.query(
        `INSERT INTO event_items (id, event_id, title, position, created_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, position = EXCLUDED.position`,
        [item.id, item.eventId, item.title, item.position, ts(item.createdAt)],
      );

      const reservation = reservationByItem.get(item.id);
      if (reservation) {
        await client.query(
          `INSERT INTO reservations
             (item_id, event_id, user_id, user_name, reserved_at, paid_kopecks, paid_at, note)
           VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7::timestamptz, $8)
           ON CONFLICT (item_id) DO UPDATE SET
             user_id      = EXCLUDED.user_id,
             user_name    = EXCLUDED.user_name,
             paid_kopecks = EXCLUDED.paid_kopecks,
             paid_at      = EXCLUDED.paid_at,
             note         = EXCLUDED.note`,
          [
            item.id,
            item.eventId,
            reservation.userId,
            reservation.userName,
            ts(reservation.reservedAt),
            reservation.paidKopecks,
            ts(reservation.paidAt),
            reservation.note,
          ],
        );
      } else {
        await client.query('DELETE FROM reservations WHERE item_id = $1', [item.id]);
      }
    }

    for (const template of snapshot.templates) {
      await client.query(
        `INSERT INTO templates (id, owner_id, name, fields, created_at)
         VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, now()))
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, fields = EXCLUDED.fields`,
        [template.id, template.ownerId, template.name, JSON.stringify(template.fields), ts(template.createdAt)],
      );
    }

    for (const transfer of snapshot.transfers) {
      await client.query(
        `INSERT INTO transfer_requests
           (id, event_id, from_user_id, to_user_id, amount_kopecks, mode, status,
            created_at, updated_at, notified_at, details_sent_at, paid_at, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), now(),
                 $9::timestamptz, $10::timestamptz, $11::timestamptz, $12::timestamptz)
         ON CONFLICT (event_id, from_user_id, to_user_id) DO UPDATE SET
           amount_kopecks  = EXCLUDED.amount_kopecks,
           mode            = EXCLUDED.mode,
           status          = EXCLUDED.status,
           notified_at     = EXCLUDED.notified_at,
           details_sent_at = EXCLUDED.details_sent_at,
           paid_at         = EXCLUDED.paid_at,
           closed_at       = EXCLUDED.closed_at,
           updated_at      = now()`,
        [
          transfer.id,
          transfer.eventId,
          transfer.fromUserId,
          transfer.toUserId,
          transfer.amountKopecks,
          transfer.mode,
          transfer.status,
          ts(transfer.createdAt),
          ts(transfer.notifiedAt),
          ts(transfer.detailsSentAt),
          ts(transfer.paidAt),
          ts(transfer.closedAt),
        ],
      );
    }
  });
};
