import { newEventId, newEventCode } from '../../domain/ids.js';
import { normalizeFields } from '../../domain/questionnaire.js';
import type { AnswerMode, DosugEvent, EventField, EventStatus } from '../../domain/types.js';
import { toIso, toIsoOrNull, toNumberOrNull } from '../mappers.js';
import type { Db } from '../pool.js';
import { KeyedLocks } from '../locks.js';
import type { CreateEventRecord, EventPatch, EventsRepository } from './contracts.js';

interface EventRow {
  id: string;
  code: string;
  title: string;
  description: string;
  starts_at: Date;
  place: string;
  place_lat: number | null;
  place_lon: number | null;
  limit_count: number | null;
  answer_mode: AnswerMode;
  status: EventStatus;
  organizer_id: number;
  organizer_name: string;
  fields: EventField[];
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

const mapEvent = (row: EventRow): DosugEvent => ({
  id: row.id,
  code: row.code,
  title: row.title,
  description: row.description,
  startsAt: toIso(row.starts_at),
  place: row.place,
  placeCoords:
    row.place_lat !== null && row.place_lon !== null
      ? { lat: Number(row.place_lat), lon: Number(row.place_lon) }
      : null,
  limit: toNumberOrNull(row.limit_count),
  fields: normalizeFields(row.fields),
  answerMode: row.answer_mode ?? 'auto',
  status: row.status,
  organizerId: row.organizer_id,
  organizerName: row.organizer_name,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  closedAt: toIsoOrNull(row.closed_at),
});

export class EventsRepo implements EventsRepository {
  private readonly locks = new KeyedLocks();

  constructor(private readonly db: Db) {}

  /**
   * Критическая секция по событию: считаем места и номера позиций по очереди.
   * Блокировка живёт в процессе (см. `db/locks.ts`): транзакция с advisory-локом
   * заняла бы соединение из пула и под нагрузкой могла бы заклинить пул целиком.
   */
  withLock<T>(eventId: string, work: () => Promise<T>): Promise<T> {
    return this.locks.run(eventId, work);
  }

  /** Создаёт событие, подбирая свободный короткий код. */
  async create(input: CreateEventRecord, attempts = 12): Promise<DosugEvent> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const code = newEventCode();
      try {
        const row = await this.db.query<EventRow>(
          `INSERT INTO events
             (id, code, title, description, starts_at, place, place_lat, place_lon,
              limit_count, fields, organizer_id, organizer_name, answer_mode)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
           RETURNING *`,
          [
            newEventId(),
            code,
            input.title,
            input.description,
            input.startsAt,
            input.place,
            input.placeCoords?.lat ?? null,
            input.placeCoords?.lon ?? null,
            input.limit,
            JSON.stringify(input.fields),
            input.organizerId,
            input.organizerName,
            input.answerMode ?? 'auto',
          ],
        );
        return mapEvent(row.rows[0]!);
      } catch (error) {
        // 23505 = unique_violation. Повторяем только конфликт по короткому коду:
        // если это столкновение первичных ключей, новый код проблему не решит.
        const conflict = error as { code?: string; constraint?: string };
        const codeTaken = conflict.code === '23505'
          && (conflict.constraint === undefined || conflict.constraint === 'events_code_key');
        if (codeTaken && attempt < attempts - 1) continue;
        throw error;
      }
    }
    throw new Error('Не удалось подобрать свободный код события');
  }

  async findById(id: string): Promise<DosugEvent | null> {
    const row = await this.db.query<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
    return row.rows[0] ? mapEvent(row.rows[0]) : null;
  }

  async findByCode(code: string): Promise<DosugEvent | null> {
    const row = await this.db.query<EventRow>(
      'SELECT * FROM events WHERE code = $1',
      [code.trim().toUpperCase()],
    );
    return row.rows[0] ? mapEvent(row.rows[0]) : null;
  }

  async listByOrganizer(organizerId: number): Promise<DosugEvent[]> {
    const rows = await this.db.query<EventRow>(
      'SELECT * FROM events WHERE organizer_id = $1 ORDER BY starts_at ASC',
      [organizerId],
    );
    return rows.rows.map(mapEvent);
  }

  async listPublished(): Promise<DosugEvent[]> {
    const rows = await this.db.query<EventRow>(
      "SELECT * FROM events WHERE status = 'published' ORDER BY starts_at ASC",
    );
    return rows.rows.map(mapEvent);
  }

  async update(id: string, patch: EventPatch): Promise<DosugEvent | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (sql: string, value: unknown): void => {
      values.push(value);
      sets.push(`${sql} = $${values.length}`);
    };

    if (patch.title !== undefined) push('title', patch.title);
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.startsAt !== undefined) push('starts_at', patch.startsAt);
    if (patch.place !== undefined) push('place', patch.place);
    if (patch.placeCoords !== undefined) {
      push('place_lat', patch.placeCoords?.lat ?? null);
      push('place_lon', patch.placeCoords?.lon ?? null);
    }
    if (patch.limit !== undefined) push('limit_count', patch.limit);
    if (patch.fields !== undefined) {
      values.push(JSON.stringify(patch.fields));
      sets.push(`fields = $${values.length}::jsonb`);
    }
    if (patch.answerMode !== undefined) push('answer_mode', patch.answerMode);
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.closedAt !== undefined) push('closed_at', patch.closedAt);

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    const row = await this.db.query<EventRow>(
      `UPDATE events SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return row.rows[0] ? mapEvent(row.rows[0]) : null;
  }

  /** Закрывает события, которые начались раньше указанного момента. */
  async closeStartedBefore(threshold: Date): Promise<DosugEvent[]> {
    const rows = await this.db.query<EventRow>(
      `UPDATE events SET status = 'closed', closed_at = now(), updated_at = now()
       WHERE status = 'published' AND starts_at < $1
       RETURNING *`,
      [threshold.toISOString()],
    );
    return rows.rows.map(mapEvent);
  }

  /** События, где пользователь организатор или участник — для «Моих событий». */
  async listForUser(userId: number): Promise<DosugEvent[]> {
    const rows = await this.db.query<EventRow>(
      `SELECT e.* FROM events e
       WHERE e.organizer_id = $1
          OR EXISTS (SELECT 1 FROM participants p WHERE p.event_id = e.id AND p.user_id = $1)
       ORDER BY e.starts_at ASC`,
      [userId],
    );
    return rows.rows.map(mapEvent);
  }
}
