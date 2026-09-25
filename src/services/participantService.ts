import type { Repositories } from '../db/repositories/index.js';
import { isGoing } from '../domain/stats.js';
import { validateAnswers } from '../domain/validation.js';
import type {
  DosugEvent,
  EventField,
  ItemWithReservation,
  Participant,
  ParticipantStatus,
} from '../domain/types.js';

export interface SaveRegistrationInput {
  event: DosugEvent;
  userId: number;
  name: string;
  username: string | null;
  contact: string;
  status: ParticipantStatus;
  answers: Record<string, string>;
}

export interface SaveRegistrationResult {
  ok: true;
  participant: Participant;
  waitlisted: boolean;
  limitReached: boolean;
}

/** Ответы не прошли проверку ограничений — нужно показать причину и вернуться к вопросу. */
export interface SaveRegistrationFailure {
  ok: false;
  failedField: EventField;
  error: string;
}

export type SaveRegistrationOutcome = SaveRegistrationResult | SaveRegistrationFailure;

export interface StatusChangeResult {
  participant: Participant;
  waitlisted: boolean;
  /** Участник, которого повысили из листа ожидания (если место освободилось). */
  promoted: Participant | null;
  /** Позиции, которые освободились после отказа от участия. */
  releasedItems: ItemWithReservation[];
}

export class ParticipantService {
  constructor(private readonly repos: Repositories) {}

  async save(input: SaveRegistrationInput): Promise<SaveRegistrationOutcome> {
    // Ограничения ответов проверяются в одном месте — и для чата, и для мини-приложения.
    const validation = validateAnswers(input.event.fields, input.answers);
    if (!validation.ok) {
      return {
        ok: false,
        failedField: validation.failedField!,
        error: validation.error ?? 'Ответ не подходит под ограничения вопроса.',
      };
    }
    const normalized: SaveRegistrationInput = { ...input, answers: validation.answers };

    const participants = await this.repos.participants.listByEvent(normalized.event.id);
    const existing = participants.find((participant) => participant.userId === normalized.userId);
    const limit = normalized.event.limit;
    const goingNow = participants.filter(
      (participant) =>
        participant.userId !== normalized.userId
        && participant.status === 'going'
        && !participant.waitlisted,
    ).length;

    const waitlisted = normalized.status === 'going' && limit !== null && goingNow >= limit;

    const participant = await this.repos.participants.upsert({
      eventId: normalized.event.id,
      userId: normalized.userId,
      name: normalized.name,
      username: normalized.username,
      contact: normalized.contact,
      status: normalized.status,
      answers: normalized.answers,
      waitlisted,
    });

    return {
      ok: true,
      participant,
      waitlisted,
      limitReached: waitlisted && !existing?.waitlisted,
    };
  }

  /**
   * Меняет статус участника. Если он отказывается, его брони из списка покупок
   * освобождаются, а на освободившееся место поднимается первый из листа ожидания.
   */
  async setStatus(
    event: DosugEvent,
    userId: number,
    status: ParticipantStatus,
  ): Promise<StatusChangeResult | null> {
    const participants = await this.repos.participants.listByEvent(event.id);
    const current = participants.find((participant) => participant.userId === userId);
    if (!current) return null;

    const othersGoing = participants.filter(
      (participant) =>
        participant.userId !== userId
        && participant.status === 'going'
        && !participant.waitlisted,
    ).length;
    const waitlisted = status === 'going' && event.limit !== null && othersGoing >= event.limit;

    const updated = await this.repos.participants.patch(event.id, userId, { status, waitlisted });
    if (!updated) return null;

    let releasedItems: ItemWithReservation[] = [];
    if (status === 'not_going') {
      releasedItems = await this.repos.items.listReservedByUser(event.id, userId);
      await this.repos.items.releaseAllForUser(event.id, userId);
    }

    const promoted = status === 'going' ? null : await this.promoteFromWaitlist(event);
    return { participant: updated, waitlisted, promoted, releasedItems };
  }

  async setAnswer(
    eventId: string,
    userId: number,
    fieldId: string,
    value: string,
  ): Promise<Participant | null> {
    const participant = await this.repos.participants.find(eventId, userId);
    if (!participant) return null;
    return this.repos.participants.patch(eventId, userId, {
      answers: { ...participant.answers, [fieldId]: value },
    });
  }

  async remove(eventId: string, userId: number): Promise<boolean> {
    await this.repos.items.releaseAllForUser(eventId, userId);
    return this.repos.participants.delete(eventId, userId);
  }

  /** Поднимает первого из листа ожидания, если есть свободное место. */
  async promoteFromWaitlist(event: DosugEvent): Promise<Participant | null> {
    if (event.limit === null) return null;
    const participants = await this.repos.participants.listByEvent(event.id);
    const going = participants.filter(
      isGoing,
    ).length;
    if (going >= event.limit) return null;

    const candidate = participants.find((participant) => participant.waitlisted);
    if (!candidate) return null;

    return this.repos.participants.patch(event.id, candidate.userId, {
      waitlisted: false,
      status: 'going',
    });
  }

  listByEvent(eventId: string): Promise<Participant[]> {
    return this.repos.participants.listByEvent(eventId);
  }

  find(eventId: string, userId: number): Promise<Participant | null> {
    return this.repos.participants.find(eventId, userId);
  }
}
