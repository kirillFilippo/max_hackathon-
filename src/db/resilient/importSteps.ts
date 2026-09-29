import type { PoolClient } from 'pg';

import type {
  DosugEvent,
  EventItem,
  Participant,
  Reservation,
  Template,
} from '../../domain/types.js';
import type { MemoryDeletions, MemorySnapshot } from '../memory/store.js';

/**
 * Шаги переноса памяти в PostgreSQL: по одному на сущность.
 *
 * Все они работают внутри одной транзакции и получают её клиент — второй клиент
 * из пула не увидел бы собственных записей и держал бы лишнее соединение.
 * Порядок шагов задаёт `importSnapshot` в `importers.ts`: события раньше заявок
 * и позиций (на них ссылаются внешние ключи), удаления — последними.
 */

/** Что пришлось изменить при переносе: вызывающий применяет это к зеркалу. */
export interface ImportResult {
  /**
   * События, которым сменили код: их код в базе был занят другим событием.
   * Память обязана узнать об этом, иначе `findByCode` будет отвечать по-разному
   * в зависимости от того, доступна база или нет.
   */
  renamedEventCodes: Array<{ id: string; from: string; to: string }>;
}

/** Приводит ISO-строку к значению для timestamptz (или к null). */
const ts = (value: string | null | undefined): string | null => value ?? null;

/**
 * Подбирает свободный код события.
 *
 * Конфликт возможен, если событие создали в памяти с кодом, который уже занят
 * в базе. Перебор суффиксов детерминированный: повторная синхронизация того же
 * снимка выберет тот же код, а не новый — иначе база и память разъедутся.
 */
const resolveEventCode = async (
  client: PoolClient,
  event: DosugEvent,
): Promise<{ code: string; renamed: boolean }> => {
  const takenByOther = async (code: string): Promise<boolean> => {
    const row = await client.query<{ id: string }>('SELECT id FROM events WHERE code = $1', [code]);
    const owner = row.rows[0];
    // Код занят только чужой строкой: свою запись этот же id мог получить раньше.
    return owner !== undefined && owner.id !== event.id;
  };

  if (!(await takenByOther(event.code))) return { code: event.code, renamed: false };
  for (let suffix = 10; suffix <= 99; suffix += 1) {
    const candidate = `${event.code}${suffix}`;
    if (!(await takenByOther(candidate))) return { code: candidate, renamed: true };
  }
  throw new Error(`Не удалось подобрать свободный код для события ${event.id}`);
};

export const upsertUsers = async (
  client: PoolClient,
  users: MemorySnapshot['users'],
): Promise<void> => {
  for (const user of users) {
    await client.query(
      `INSERT INTO users (user_id, name, username, contact, created_at, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), now())
       ON CONFLICT (user_id) DO UPDATE SET
         name           = EXCLUDED.name,
         username       = EXCLUDED.username,
         contact        = EXCLUDED.contact,
         updated_at     = now()`,
      [user.userId, user.name, user.username, user.contact, ts(user.createdAt)],
    );
  }
};

/** Пишет события и возвращает те, которым пришлось сменить код. */
export const upsertEvents = async (
  client: PoolClient,
  events: DosugEvent[],
): Promise<ImportResult['renamedEventCodes']> => {
  const renamedEventCodes: ImportResult['renamedEventCodes'] = [];

  for (const event of events) {
    const { code, renamed } = await resolveEventCode(client, event);
    if (renamed) renamedEventCodes.push({ id: event.id, from: event.code, to: code });

    await client.query(
      `INSERT INTO events
         (id, code, title, description, starts_at, place, place_lat, place_lon,
          limit_count, status, organizer_id, organizer_name, fields, answer_mode,
          created_at, updated_at, closed_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14,
               COALESCE($15::timestamptz, now()), now(), $16::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         code           = EXCLUDED.code,
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

  return renamedEventCodes;
};

export const upsertParticipants = async (
  client: PoolClient,
  participants: Participant[],
): Promise<void> => {
  // id из снимка может быть занят другой заявкой: тогда пишем по естественному
  // ключу (event_id, user_id) и оставляем id, который уже есть в базе — иначе
  // конфликт первичного ключа откатывал бы всю синхронизацию.
  const participantIds = new Map(
    (
      await client.query<{ id: string; event_id: string; user_id: number }>(
        `SELECT id, event_id, user_id FROM participants
         WHERE (event_id, user_id) IN (
           SELECT * FROM unnest($1::text[], $2::bigint[])
         )`,
        [
          participants.map((participant) => participant.eventId),
          participants.map((participant) => participant.userId),
        ],
      )
    ).rows.map((row) => [`${row.event_id}\u0000${row.user_id}`, row.id]),
  );

  for (const participant of participants) {
    const participantId = participantIds.get(`${participant.eventId}\u0000${participant.userId}`)
      ?? participant.id;
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
        participantId,
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
};

/** Позиции и брони в снимке лежат отдельно — как в базе. */
export const upsertItems = async (
  client: PoolClient,
  items: EventItem[],
  reservations: Reservation[],
): Promise<void> => {
  const reservationByItem = new Map(
    reservations.map((reservation) => [reservation.itemId, reservation]),
  );

  for (const item of items) {
    await client.query(
      `INSERT INTO event_items (id, event_id, title, position, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, position = EXCLUDED.position`,
      [item.id, item.eventId, item.title, item.position, ts(item.createdAt)],
    );

    const reservation = reservationByItem.get(item.id);
    if (!reservation) {
      // Если брони в снимке нет — молчим. Раньше здесь стоял DELETE, и он сносил
      // бронь, поставленную в базе уже после последнего обновления зеркала:
      // «позиция свободна у нас» и «бронь сняли в офлайне» — разные вещи.
      // Настоящие удаления приходят отдельно, в `deletions`.
      continue;
    }

    await client.query(
      `INSERT INTO reservations
         (item_id, event_id, user_id, user_name, reserved_at, note)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6)
       ON CONFLICT (item_id) DO UPDATE SET
         user_id      = EXCLUDED.user_id,
         user_name    = EXCLUDED.user_name,
         note         = EXCLUDED.note`,
      [
        item.id,
        item.eventId,
        reservation.userId,
        reservation.userName,
        ts(reservation.reservedAt),
        reservation.note,
      ],
    );
  }
};

export const upsertTemplates = async (
  client: PoolClient,
  templates: Template[],
): Promise<void> => {
  for (const template of templates) {
    await client.query(
      `INSERT INTO templates (id, owner_id, name, fields, created_at)
       VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, now()))
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, fields = EXCLUDED.fields`,
      [template.id, template.ownerId, template.name, JSON.stringify(template.fields), ts(template.createdAt)],
    );
  }
};

/**
 * Применяет удаления, сделанные без связи.
 *
 * Это последний шаг: удаление должно быть последним словом, иначе следующая
 * синхронизация вернула бы строку обратно.
 */
export const applyDeletions = async (
  client: PoolClient,
  deletions: MemoryDeletions,
): Promise<void> => {
  for (const participant of deletions.participants) {
    await client.query('DELETE FROM participants WHERE event_id = $1 AND user_id = $2', [
      participant.eventId,
      participant.userId,
    ]);
  }
  for (const itemId of deletions.items) {
    // Позиция уходит вместе с бронью — как ON DELETE CASCADE в схеме.
    await client.query('DELETE FROM event_items WHERE id = $1', [itemId]);
  }
  for (const itemId of deletions.reservations) {
    await client.query('DELETE FROM reservations WHERE item_id = $1', [itemId]);
  }
  for (const templateId of deletions.templates) {
    await client.query('DELETE FROM templates WHERE id = $1', [templateId]);
  }
};
