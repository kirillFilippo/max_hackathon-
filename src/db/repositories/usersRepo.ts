import type { UserProfile } from '../../domain/types.js';
import { toIso } from '../mappers.js';
import type { Db } from '../pool.js';
import type { UserPatch, UsersRepository } from './contracts.js';

interface UserRow {
  user_id: number;
  name: string;
  username: string | null;
  contact: string;
  bank_name: string;
  payment_handle: string;
  created_at: Date;
  updated_at: Date;
}

const mapUser = (row: UserRow): UserProfile => ({
  userId: row.user_id,
  name: row.name,
  username: row.username,
  contact: row.contact,
  bankName: row.bank_name,
  paymentHandle: row.payment_handle,
});

/**
 * Профили пользователей. Живут в БД, поэтому контакт и реквизиты для перевода
 * не теряются при перезапуске бота и деплое.
 */
export class UsersRepo implements UsersRepository {
  constructor(private readonly db: Db) {}

  async ensure(userId: number, patch: UserPatch = {}): Promise<UserProfile> {
    const row = await this.db.query<UserRow>(
      `INSERT INTO users (user_id, name, username, contact)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         name       = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE users.name END,
         username   = COALESCE(EXCLUDED.username, users.username),
         contact    = CASE WHEN EXCLUDED.contact <> '' THEN EXCLUDED.contact ELSE users.contact END,
         updated_at = now()
       RETURNING *`,
      [userId, patch.name ?? '', patch.username ?? null, patch.contact ?? ''],
    );
    return mapUser(row.rows[0]!);
  }

  async find(userId: number): Promise<UserProfile | null> {
    const row = await this.db.query<UserRow>('SELECT * FROM users WHERE user_id = $1', [userId]);
    return row.rows[0] ? mapUser(row.rows[0]) : null;
  }

  async saveContact(userId: number, contact: string): Promise<UserProfile> {
    const row = await this.db.query<UserRow>(
      `INSERT INTO users (user_id, contact) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET contact = EXCLUDED.contact, updated_at = now()
       RETURNING *`,
      [userId, contact],
    );
    return mapUser(row.rows[0]!);
  }

  async savePaymentDetails(
    userId: number,
    bankName: string,
    paymentHandle: string,
  ): Promise<UserProfile> {
    const row = await this.db.query<UserRow>(
      `INSERT INTO users (user_id, bank_name, payment_handle) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         bank_name = EXCLUDED.bank_name,
         payment_handle = EXCLUDED.payment_handle,
         updated_at = now()
       RETURNING *`,
      [userId, bankName, paymentHandle],
    );
    return mapUser(row.rows[0]!);
  }

  async createdAt(userId: number): Promise<string | null> {
    const row = await this.db.query<{ created_at: Date }>(
      'SELECT created_at FROM users WHERE user_id = $1',
      [userId],
    );
    return row.rows[0] ? toIso(row.rows[0].created_at) : null;
  }
}
