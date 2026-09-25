import type { Logger } from '../../logger.js';
import type { MemoryStore } from '../memory/store.js';
import type { Db } from '../pool.js';
import { importSnapshot } from './importers.js';

/**
 * Синхронизация памяти с базой: всё, что накопилось за время обрыва связи,
 * уезжает в PostgreSQL с теми же идентификаторами. Запись идемпотентна —
 * повторный вызов обновляет те же строки, поэтому синхронизацию можно
 * запускать после каждого восстановления связи.
 */
export const syncMemoryToDb = async (
  db: Db,
  store: MemoryStore,
  logger: Logger,
): Promise<Record<string, number>> => {
  const counts = store.counts();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    logger.info('Синхронизация не нужна: в памяти нет данных.');
    return counts;
  }

  const snapshot = store.snapshot();
  await importSnapshot(db, snapshot);
  logger.info(
    `Перенесено в PostgreSQL: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}.`,
  );
  return counts;
};
