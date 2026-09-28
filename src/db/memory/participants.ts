import { newParticipantId } from '../../domain/ids.js';
import type {
  DosugEvent,
  EventField,
  EventItem,
  ItemWithReservation,
  Participant,
  Reservation,
  Template,
  TransferRequest,
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
  TransferPatch,
  TransfersRepository,
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

import { mapParticipant, nowIso, sortByTime } from './helpers.js';

export class MemoryParticipantsRepository implements ParticipantsRepository {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Пишет участника по ключу (eventId, userId). Ответы при повторной записи
   * сливаются со старыми (`answers || EXCLUDED.answers` в SQL), остальные поля
   * перезаписываются, дата создания сохраняется.
   */
  async upsert(input: SaveParticipantInput): Promise<Participant> {
    const current = this.store.participant(input.eventId, input.userId);
    const now = nowIso();
    const participant: Participant = current
      ? {
          ...current,
          name: input.name,
          username: input.username,
          contact: input.contact,
          status: input.status,
          // Как и в базе: ответы заменяются целиком (слияние не даёт очистить ответ).
          answers: { ...input.answers },
          waitlisted: input.waitlisted,
          updatedAt: now,
        }
      : {
          id: newParticipantId(),
          eventId: input.eventId,
          userId: input.userId,
          name: input.name,
          username: input.username,
          contact: input.contact,
          status: input.status,
          answers: { ...input.answers },
          waitlisted: input.waitlisted,
          confirmSentAt: null,
          finalSentAt: null,
          createdAt: now,
          updatedAt: now,
        };
    this.store.putParticipant(participant);
    return mapParticipant(participant);
  }

  /** Патч применяет только переданные поля; `answers` заменяет ответы целиком. */
  async patch(eventId: string, userId: number, patch: ParticipantPatch): Promise<Participant | null> {
    const current = this.store.participant(eventId, userId);
    if (!current) return null;

    const changed =
      patch.name !== undefined ||
      patch.username !== undefined ||
      patch.contact !== undefined ||
      patch.status !== undefined ||
      patch.answers !== undefined ||
      patch.waitlisted !== undefined ||
      patch.confirmSentAt !== undefined ||
      patch.finalSentAt !== undefined;
    if (!changed) return mapParticipant(current);

    const updated: Participant = { ...current, updatedAt: nowIso() };
    if (patch.name !== undefined) updated.name = patch.name;
    if (patch.username !== undefined) updated.username = patch.username;
    if (patch.contact !== undefined) updated.contact = patch.contact;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.answers !== undefined) updated.answers = { ...patch.answers };
    if (patch.waitlisted !== undefined) updated.waitlisted = patch.waitlisted;
    if (patch.confirmSentAt !== undefined) updated.confirmSentAt = patch.confirmSentAt;
    if (patch.finalSentAt !== undefined) updated.finalSentAt = patch.finalSentAt;

    this.store.putParticipant(updated);
    return mapParticipant(updated);
  }

  async find(eventId: string, userId: number): Promise<Participant | null> {
    const participant = this.store.participant(eventId, userId);
    return participant ? mapParticipant(participant) : null;
  }

  async listByEvent(eventId: string): Promise<Participant[]> {
    const participants = this.store
      .participants()
      .filter((participant) => participant.eventId === eventId)
      .map(mapParticipant);
    return sortByTime(participants, (participant) => participant.createdAt);
  }

  async listByUser(userId: number): Promise<Participant[]> {
    const participants = this.store
      .participants()
      .filter((participant) => participant.userId === userId)
      .map(mapParticipant);
    return sortByTime(participants, (participant) => participant.createdAt, 'desc');
  }

  async delete(eventId: string, userId: number): Promise<boolean> {
    return this.store.deleteParticipant(eventId, userId);
  }
}
