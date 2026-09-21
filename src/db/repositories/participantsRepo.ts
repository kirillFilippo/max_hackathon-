import { newParticipantId } from '../../domain/ids.js';
import type { Participant, ParticipantStatus } from '../../domain/types.js';
import { toIso, toIsoOrNull } from '../mappers.js';
import type { Db } from '../pool.js';

interface ParticipantRow {
  id: string;
  event_id: string;
  user_id: number;
  name: string;
  username: string | null;
  contact: string;
  status: ParticipantStatus;
  answers: Record<string, string>;
  waitlisted: boolean;
  confirm_sent_at: Date | null;
  final_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const mapParticipant = (row: ParticipantRow): Participant => ({
  id: row.id,
  eventId: row.event_id,
  userId: row.user_id,
  name: row.name,
  username: row.username,
  contact: row.contact,
  status: row.status,
  answers: row.answers ?? {},
  waitlisted: row.waitlisted,
  confirmSentAt: toIsoOrNull(row.confirm_sent_at),
  finalSentAt: toIsoOrNull(row.final_sent_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

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

export class ParticipantsRepo {
  constructor(private readonly db: Db) {}

  async upsert(input: SaveParticipantInput): Promise<Participant> {
    const row = await this.db.query<ParticipantRow>(
      `INSERT INTO participants
         (id, event_id, user_id, name, username, contact, status, answers, waitlisted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (event_id, user_id) DO UPDATE SET
         name       = EXCLUDED.name,
         username   = EXCLUDED.username,
         contact    = EXCLUDED.contact,
         status     = EXCLUDED.status,
         answers    = participants.answers || EXCLUDED.answers,
         waitlisted = EXCLUDED.waitlisted,
         updated_at = now()
       RETURNING *`,
      [
        newParticipantId(),
        input.eventId,
        input.userId,
        input.name,
        input.username,
        input.contact,
        input.status,
        JSON.stringify(input.answers),
        input.waitlisted,
      ],
    );
    return mapParticipant(row.rows[0]!);
  }

  async patch(eventId: string, userId: number, patch: ParticipantPatch): Promise<Participant | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (sql: string, value: unknown): void => {
      values.push(value);
      sets.push(`${sql} = $${values.length}`);
    };

    if (patch.name !== undefined) push('name', patch.name);
    if (patch.username !== undefined) push('username', patch.username);
    if (patch.contact !== undefined) push('contact', patch.contact);
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.answers !== undefined) {
      values.push(JSON.stringify(patch.answers));
      sets.push(`answers = $${values.length}::jsonb`);
    }
    if (patch.waitlisted !== undefined) push('waitlisted', patch.waitlisted);
    if (patch.confirmSentAt !== undefined) push('confirm_sent_at', patch.confirmSentAt);
    if (patch.finalSentAt !== undefined) push('final_sent_at', patch.finalSentAt);

    if (sets.length === 0) return this.find(eventId, userId);

    values.push(eventId, userId);
    const row = await this.db.query<ParticipantRow>(
      `UPDATE participants SET ${sets.join(', ')}, updated_at = now()
       WHERE event_id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values,
    );
    return row.rows[0] ? mapParticipant(row.rows[0]) : null;
  }

  async find(eventId: string, userId: number): Promise<Participant | null> {
    const row = await this.db.query<ParticipantRow>(
      'SELECT * FROM participants WHERE event_id = $1 AND user_id = $2',
      [eventId, userId],
    );
    return row.rows[0] ? mapParticipant(row.rows[0]) : null;
  }

  async listByEvent(eventId: string): Promise<Participant[]> {
    const rows = await this.db.query<ParticipantRow>(
      'SELECT * FROM participants WHERE event_id = $1 ORDER BY created_at ASC',
      [eventId],
    );
    return rows.rows.map(mapParticipant);
  }

  async listByUser(userId: number): Promise<Participant[]> {
    const rows = await this.db.query<ParticipantRow>(
      'SELECT * FROM participants WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.rows.map(mapParticipant);
  }

  async delete(eventId: string, userId: number): Promise<boolean> {
    const row = await this.db.query(
      'DELETE FROM participants WHERE event_id = $1 AND user_id = $2 RETURNING id',
      [eventId, userId],
    );
    return row.rowCount === 1;
  }
}
