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
  // Удаления тоже требуют переноса: без них «сняли бронь, пока связи не было»
  // осталось бы в базе навсегда.
  const deletions = store.pendingDeletionCount();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) + deletions;
  if (total === 0) {
    logger.info('Синхронизация не нужна: в памяти нет данных.');
    return counts;
  }

  const snapshot = store.snapshot();
  const { renamedEventCodes } = await importSnapshot(db, snapshot);

  // Код события мог измениться: в базе он был занят другим событием. Приводим
  // зеркало к тому же виду, иначе `findByCode` отвечает по-разному в зависимости
  // от того, доступна база или нет.
  for (const rename of renamedEventCodes) {
    const event = store.event(rename.id);
    if (!event) continue;
    store.putEvent({ ...event, code: rename.to });
    logger.warn(
      `Код события ${rename.from} был занят в базе: событие ${rename.id} перенесено как ${rename.to}.`,
    );
  }

  // Удаления применены — снимаем отметки, чтобы они не уехали в следующий снимок.
  store.clearDeletions();

  logger.info(
    `Перенесено в PostgreSQL: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}`
      + (deletions > 0 ? `, удалений=${deletions}` : '')
      + '.',
  );
  return counts;
};
