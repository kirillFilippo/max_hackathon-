import { newTemplateId } from '../../domain/ids.js';
import type { EventField, Template } from '../../domain/types.js';
import { toIso } from '../mappers.js';
import type { Db } from '../pool.js';

interface TemplateRow {
  id: string;
  owner_id: number;
  name: string;
  fields: EventField[];
  created_at: Date;
}

const mapTemplate = (row: TemplateRow): Template => ({
  id: row.id,
  name: row.name,
  fields: Array.isArray(row.fields) ? row.fields : [],
  builtin: false,
  ownerId: row.owner_id,
  createdAt: toIso(row.created_at),
});

export class TemplatesRepo {
  constructor(private readonly db: Db) {}

  async listByOwner(ownerId: number): Promise<Template[]> {
    const rows = await this.db.query<TemplateRow>(
      'SELECT * FROM templates WHERE owner_id = $1 ORDER BY created_at ASC',
      [ownerId],
    );
    return rows.rows.map(mapTemplate);
  }

  async find(id: string): Promise<Template | null> {
    const row = await this.db.query<TemplateRow>('SELECT * FROM templates WHERE id = $1', [id]);
    return row.rows[0] ? mapTemplate(row.rows[0]) : null;
  }

  async create(ownerId: number, name: string, fields: EventField[]): Promise<Template> {
    const row = await this.db.query<TemplateRow>(
      `INSERT INTO templates (id, owner_id, name, fields)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
      [newTemplateId(), ownerId, name, JSON.stringify(fields)],
    );
    return mapTemplate(row.rows[0]!);
  }

  async rename(id: string, ownerId: number, name: string): Promise<Template | null> {
    const row = await this.db.query<TemplateRow>(
      'UPDATE templates SET name = $3 WHERE id = $1 AND owner_id = $2 RETURNING *',
      [id, ownerId, name],
    );
    return row.rows[0] ? mapTemplate(row.rows[0]) : null;
  }

  async updateFields(id: string, ownerId: number, fields: EventField[]): Promise<Template | null> {
    const row = await this.db.query<TemplateRow>(
      'UPDATE templates SET fields = $3::jsonb WHERE id = $1 AND owner_id = $2 RETURNING *',
      [id, ownerId, JSON.stringify(fields)],
    );
    return row.rows[0] ? mapTemplate(row.rows[0]) : null;
  }

  async delete(id: string, ownerId: number): Promise<boolean> {
    const row = await this.db.query(
      'DELETE FROM templates WHERE id = $1 AND owner_id = $2 RETURNING id',
      [id, ownerId],
    );
    return row.rowCount === 1;
  }
}
