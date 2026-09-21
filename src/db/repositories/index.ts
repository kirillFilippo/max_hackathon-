import type { Db } from '../pool.js';
import { EventsRepo } from './eventsRepo.js';
import { ItemsRepo } from './itemsRepo.js';
import { ParticipantsRepo } from './participantsRepo.js';
import { TemplatesRepo } from './templatesRepo.js';
import { TransfersRepo } from './transfersRepo.js';
import { UsersRepo } from './usersRepo.js';

export { EventsRepo, ItemsRepo, ParticipantsRepo, TemplatesRepo, TransfersRepo, UsersRepo };

/** Набор репозиториев — единственная точка доступа сервисов к базе. */
export interface Repositories {
  users: UsersRepo;
  events: EventsRepo;
  items: ItemsRepo;
  participants: ParticipantsRepo;
  templates: TemplatesRepo;
  transfers: TransfersRepo;
}

export const createRepositories = (db: Db): Repositories => ({
  users: new UsersRepo(db),
  events: new EventsRepo(db),
  items: new ItemsRepo(db),
  participants: new ParticipantsRepo(db),
  templates: new TemplatesRepo(db),
  transfers: new TransfersRepo(db),
});
