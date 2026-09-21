import type { Logger } from '../logger.js';
import { MIGRATIONS } from './migrations.js';
import type { Db } from './pool.js';

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Применяет неприменённые миграции по порядку, каждую — в своей транзакции. */
export const migrate = async (db: Db, logger: Logger): Promise<string[]> => {
  await db.query(MIGRATIONS_TABLE);
  const applied = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(applied.rows.map((row) => row.version));
  const executed: string[] = [];

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    logger.info(`Применяю миграцию ${migration.version}: ${migration.description}`);
    await db.transaction(async (client) => {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
    });
    executed.push(migration.version);
  }

  if (executed.length === 0) logger.info('Схема БД актуальна, миграции не требуются');
  return executed;
};
