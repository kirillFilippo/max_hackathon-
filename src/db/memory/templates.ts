import { newTemplateId } from '../../domain/ids.js';
import type {
  DosugEvent,
  EventField,
  EventItem,
  ItemWithReservation,
  Participant,
  Reservation,
  Template,
  UserProfile,
} from '../../domain/types.js';
import type {
  CreateEventRecord,
  EventPatch,
  EventsRepository,
  ItemsRepository,
  ParticipantPatch,
  ParticipantsRepository,
  Repositories,
  ReserveResult,
  SaveParticipantInput,
  TemplatesRepository,
  UserPatch,
  UsersRepository,
} from '../repositories/contracts.js';
import { MemoryStore } from './store.js';
import type { MemorySnapshot, StoredUserProfile } from './store.js';

/**
 * Репозитории поверх памяти: та же семантика, что у PostgreSQL-версии
 * (`../repositories/*Repo.ts`). Нужны, чтобы бот работал при недоступной базе,
 * а накопленное состояние потом уехало в БД через `MemoryStore.snapshot()`.
 *
 * Порядок сортировки, состав полей и null-значения повторяют SQL: расхождение
 * здесь заметно сервисам, которые не знают, откуда пришли данные.
 */

export { MemoryStore };
export type { MemorySnapshot, StoredUserProfile };

import { mapTemplate, nowIso, sortByTime } from './helpers.js';

export class MemoryTemplatesRepository implements TemplatesRepository {
  constructor(private readonly store: MemoryStore) {}

  async listByOwner(ownerId: number): Promise<Template[]> {
    const templates = this.store
      .templates()
      .filter((template) => template.ownerId === ownerId)
      .map(mapTemplate);
    return sortByTime(templates, (template) => template.createdAt);
  }

  async find(id: string): Promise<Template | null> {
    const template = this.store.template(id);
    return template ? mapTemplate(template) : null;
  }

  async create(ownerId: number, name: string, fields: EventField[]): Promise<Template> {
    const template: Template = {
      id: newTemplateId(),
      name,
      fields: [...fields],
      builtin: false,
      ownerId,
      createdAt: nowIso(),
    };
    this.store.putTemplate(template);
    return mapTemplate(template);
  }

  async rename(id: string, ownerId: number, name: string): Promise<Template | null> {
    const current = this.store.template(id);
    if (!current || current.ownerId !== ownerId) return null;
    const updated: Template = { ...current, name };
    this.store.putTemplate(updated);
    return mapTemplate(updated);
  }

  async updateFields(id: string, ownerId: number, fields: EventField[]): Promise<Template | null> {
    const current = this.store.template(id);
    if (!current || current.ownerId !== ownerId) return null;
    const updated: Template = { ...current, fields: [...fields] };
    this.store.putTemplate(updated);
    return mapTemplate(updated);
  }

  async delete(id: string, ownerId: number): Promise<boolean> {
    const current = this.store.template(id);
    if (!current || current.ownerId !== ownerId) return false;
    return this.store.deleteTemplate(id);
  }
}
