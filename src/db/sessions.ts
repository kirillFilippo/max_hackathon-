import type { AsyncSessionStore } from '@maxhub/max-bot-api';

import type { Db } from './pool.js';

/**
 * Сессии (черновики мастеров) в PostgreSQL. Благодаря этому незавершённые шаги
 * переживают перезапуск бота и деплой — в отличие от памяти процесса или
 * локального файла.
 */
export class PgSessionStore<T extends object> implements AsyncSessionStore<T> {
  constructor(
    private readonly db: Db,
    private readonly ttlMs: number,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const row = await this.db.query<{ value: T }>(
      'SELECT value FROM sessions WHERE key = $1 AND expires_at > now()',
      [key],
    );
    return row.rows[0]?.value;
  }

  async set(key: string, value: T): Promise<void> {
    await this.db.query(
      `INSERT INTO sessions (key, value, expires_at)
       VALUES ($1, $2::jsonb, now() + make_interval(secs => $3))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(value), this.ttlMs / 1000],
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE key = $1', [key]);
  }

  /**
   * Черновики пользователя (ключ имеет вид «user:chat»). Нужно мини-приложению:
   * оно сохраняет вопросы в мастер, не зная, в каком именно чате тот открыт.
   */
  async findByUser(userId: number): Promise<Array<{ key: string; value: T }>> {
    const rows = await this.db.query<{ key: string; value: T }>(
      `SELECT key, value FROM sessions
       WHERE key LIKE $1 AND expires_at > now()
       ORDER BY expires_at DESC`,
      [`${userId}:%`],
    );
    return rows.rows;
  }

  /** Чистит просроченные черновики; вызывается при старте и планировщиком. */
  async cleanupExpired(): Promise<number> {
    const result = await this.db.query('DELETE FROM sessions WHERE expires_at <= now()');
    return result.rowCount ?? 0;
  }
}
