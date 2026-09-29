import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import type { Logger } from '../logger.js';

// bigint (int8) по умолчанию приходит строкой — приводим к number: id MAX и счётчики
// не выходят за пределы безопасного целого.
types.setTypeParser(types.builtins.INT8, (value: string) => Number(value));

export interface DbOptions {
  connectionString: string;
  maxConnections: number;
  /** true — падать при ошибке соединения (используется при старте). */
  ssl?: boolean;
}

/**
 * Пул соединений PostgreSQL. Всё приложение работает через него: репозитории,
 * сессии и миграции. Данные лежат в БД, поэтому переживают перезапуск бота и
 * деплой (том docker volume или внешний кластер).
 */
export class Db {
  readonly pool: Pool;

  constructor(options: DbOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections,
      ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
      application_name: 'max-dosug-bot',
    });
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, values as never[]);
  }

  /** Выполняет работу в транзакции: COMMIT при успехе, ROLLBACK при ошибке. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // соединение могло уже упасть — исходная ошибка важнее
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const createDb = (options: DbOptions, logger: Logger): Db => {
  const db = new Db(options);
  db.pool.on('error', (error) => logger.error('Ошибка пула PostgreSQL', error));
  return db;
};
