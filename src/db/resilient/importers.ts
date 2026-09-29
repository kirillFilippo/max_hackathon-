import type { Db } from '../pool.js';
import { emptyDeletions, type MemorySnapshot } from '../memory/store.js';
import {
  applyDeletions,
  upsertEvents,
  upsertItems,
  upsertParticipants,
  upsertTemplates,
  upsertUsers,
  type ImportResult,
} from './importSteps.js';

/**
 * Запись состояния из памяти в PostgreSQL с сохранением идентификаторов.
 *
 * Обычные репозитории сами придумывают id и короткие коды, поэтому для
 * синхронизации они не годятся: событие, созданное в памяти во время обрыва
 * связи, должно приехать в базу с тем же id, кодом и ссылками. Здесь всё
 * пишется напрямую через SQL и идемпотентно: повторный вызов обновляет те же
 * строки, а не создаёт дубли.
 *
 * Сам перенос — это порядок шагов из `importSteps.ts`: события раньше заявок и
 * позиций (на них ссылаются внешние ключи), удаления — последними.
 */

export type { ImportResult };

export const importSnapshot = async (db: Db, snapshot: MemorySnapshot): Promise<ImportResult> => {
  let renamedEventCodes: ImportResult['renamedEventCodes'] = [];

  await db.transaction(async (client) => {
    await upsertUsers(client, snapshot.users);
    renamedEventCodes = await upsertEvents(client, snapshot.events);
    await upsertParticipants(client, snapshot.participants);
    await upsertItems(client, snapshot.items, snapshot.reservations);
    await upsertTemplates(client, snapshot.templates);
    await applyDeletions(client, snapshot.deletions ?? emptyDeletions());
  });

  return { renamedEventCodes };
};
