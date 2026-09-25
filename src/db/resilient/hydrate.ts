import type { Logger } from '../../logger.js';
import type { MemoryStore } from '../memory/store.js';
import type { Repositories } from '../repositories/contracts.js';

/**
 * Прогрев зеркала: читаем из базы то, что бот и так показывает, и складываем
 * в память. Нужен, чтобы к моменту обрыва связи в памяти уже лежало текущее
 * состояние — тогда пользователи не заметят пропажи данных.
 *
 * Намеренно используем обычные методы репозиториев, а не SQL: память получает
 * ровно те же объекты, что видит бот. Закрытые события в прогрев не попадают —
 * они и в интерфейсе не нужны.
 */
export const hydrateMemory = async (
  pg: Repositories,
  store: MemoryStore,
  logger: Logger,
): Promise<Record<string, number>> => {
  const events = await pg.events.listPublished();
  const userIds = new Set<number>();

  for (const event of events) {
    store.putEvent(event);
    userIds.add(event.organizerId);

    for (const participant of await pg.participants.listByEvent(event.id)) {
      store.putParticipant(participant);
      userIds.add(participant.userId);
    }
    for (const item of await pg.items.listByEvent(event.id)) store.putItem(item);
    for (const transfer of await pg.transfers.listByEvent(event.id)) store.putTransfer(transfer);
  }

  for (const userId of userIds) {
    const profile = await pg.users.find(userId);
    if (profile) store.putUser(profile);
    for (const template of await pg.templates.listByOwner(userId)) store.putTemplate(template);
  }

  const counts = store.counts();
  logger.info(
    `Зеркало в памяти прогрето: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}.`,
  );
  return counts;
};
