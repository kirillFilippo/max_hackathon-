import type { Repositories } from '../repositories/contracts.js';
import { MemoryEventsRepository } from './events.js';
import { MemoryItemsRepository } from './items.js';
import { MemoryParticipantsRepository } from './participants.js';
import { MemoryTemplatesRepository } from './templates.js';
import { MemoryUsersRepository } from './users.js';
import { MemoryStore } from './store.js';

/**
 * Хранилище в памяти: по файлу на сущность, как и в SQL-репозиториях.
 * Реализация обязана повторять семантику PostgreSQL — см. инвариант в
 * DEVELOPER-GUIDE: правка SQL-репозитория требует такой же правки здесь.
 */
export { MemoryStore } from './store.js';
export type { MemorySnapshot, StoredUserProfile } from './store.js';

export {
  MemoryEventsRepository,
  MemoryItemsRepository,
  MemoryParticipantsRepository,
  MemoryTemplatesRepository,
  MemoryUsersRepository,
};

export const createMemoryRepositories = (store: MemoryStore = new MemoryStore()): Repositories => ({
  users: new MemoryUsersRepository(store),
  events: new MemoryEventsRepository(store),
  items: new MemoryItemsRepository(store),
  participants: new MemoryParticipantsRepository(store),
  templates: new MemoryTemplatesRepository(store),
});
