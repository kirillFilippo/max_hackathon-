import type { Db } from '../pool.js';
import { EventsRepo } from './eventsRepo.js';
import { ItemsRepo } from './itemsRepo.js';
import { ParticipantsRepo } from './participantsRepo.js';
import { TemplatesRepo } from './templatesRepo.js';
import { UsersRepo } from './usersRepo.js';

export { EventsRepo, ItemsRepo, ParticipantsRepo, TemplatesRepo, UsersRepo };
export * from './contracts.js';

import type { Repositories } from './contracts.js';

/**
 * Реализация хранилища на PostgreSQL. Сервисы работают с интерфейсами
 * (`contracts.ts`), поэтому ту же роль может играть память — см. `db/memory`
 * и `db/resilient`.
 */
export const createRepositories = (db: Db): Repositories => ({
  users: new UsersRepo(db),
  events: new EventsRepo(db),
  items: new ItemsRepo(db),
  participants: new ParticipantsRepo(db),
  templates: new TemplatesRepo(db),
});
