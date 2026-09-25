import { buildInviteUrl } from '../domain/links.js';
import type { AppConfig } from '../config.js';
import { formatDateTime } from '../domain/datetime.js';
import type { Repositories } from '../db/repositories/index.js';
import { computeEventStats } from '../domain/stats.js';
import { questionnaireWeight, resolveAnswerMode } from '../domain/questionnaire.js';
import type {
  AnswerMode,
  DosugEvent,
  EffectiveAnswerMode,
  EventField,
  EventStats,
  Participant,
} from '../domain/types.js';

export interface CreateEventInput {
  title: string;
  description: string;
  startsAt: string;
  place: string;
  placeCoords: { lat: number; lon: number } | null;
  limit: number | null;
  fields: EventField[];
  answerMode?: AnswerMode;
  organizerId: number;
  organizerName: string;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  startsAt?: string;
  place?: string;
  placeCoords?: { lat: number; lon: number } | null;
  limit?: number | null;
  fields?: EventField[];
  answerMode?: AnswerMode;
}

export interface UpdateEventResult {
  event: DosugEvent;
  changes: string[];
}

export class EventService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: AppConfig,
  ) {}

  create(input: CreateEventInput): Promise<DosugEvent> {
    return this.repos.events.create({
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      place: input.place,
      placeCoords: input.placeCoords,
      limit: input.limit,
      fields: input.fields,
      answerMode: input.answerMode ?? 'auto',
      organizerId: input.organizerId,
      organizerName: input.organizerName,
    });
  }

  listForUser(userId: number): Promise<DosugEvent[]> {
    return this.repos.events.listForUser(userId);
  }

  listByOrganizer(organizerId: number): Promise<DosugEvent[]> {
    return this.repos.events.listByOrganizer(organizerId);
  }

  findById(id: string): Promise<DosugEvent | null> {
    return this.repos.events.findById(id);
  }

  findByCode(code: string): Promise<DosugEvent | null> {
    return this.repos.events.findByCode(code);
  }

  async update(id: string, patch: UpdateEventInput): Promise<UpdateEventResult> {
    const before = await this.repos.events.findById(id);
    if (!before) throw new Error(`Событие ${id} не найдено`);

    const changes: string[] = [];
    const tz = this.config.appTz;
    if (patch.title !== undefined && patch.title !== before.title) {
      changes.push(`название: «${before.title}» → «${patch.title}»`);
    }
    if (patch.startsAt !== undefined && patch.startsAt !== before.startsAt) {
      changes.push(
        `дата и время: ${formatDateTime(before.startsAt, tz)} → ${formatDateTime(patch.startsAt, tz)}`,
      );
    }
    if (patch.place !== undefined && patch.place !== before.place) {
      changes.push(`место: ${before.place} → ${patch.place}`);
    } else if (patch.placeCoords !== undefined) {
      changes.push('уточнена точка на карте');
    }
    if (patch.description !== undefined && patch.description !== before.description) {
      changes.push('описание обновлено');
    }
    if (patch.limit !== undefined && patch.limit !== before.limit) {
      changes.push(`лимит участников: ${before.limit ?? 'без лимита'} → ${patch.limit ?? 'без лимита'}`);
    }
    if (patch.fields !== undefined && patch.fields.length !== before.fields.length) {
      changes.push(`вопросов участникам: ${before.fields.length} → ${patch.fields.length}`);
    }
    if (patch.answerMode !== undefined && patch.answerMode !== before.answerMode) {
      changes.push('изменён способ заполнения анкеты');
    }

    const event = await this.repos.events.update(id, patch);
    if (!event) throw new Error(`Событие ${id} не найдено`);
    return { event, changes };
  }

  async close(id: string): Promise<DosugEvent | null> {
    return this.repos.events.update(id, { status: 'closed', closedAt: new Date().toISOString() });
  }

  /** Автоматически закрывает события, которые начались больше `EVENT_STALE_HOURS` назад. */
  async closeExpired(now: Date, staleHours = this.config.eventStaleHours): Promise<DosugEvent[]> {
    const threshold = new Date(now.getTime() - staleHours * 3_600_000);
    return this.repos.events.closeStartedBefore(threshold);
  }

  inviteLink(event: DosugEvent, botUsername?: string): string | null {
    const username = botUsername ?? this.config.botUsername;
    return username ? buildInviteUrl(username, event.code) : null;
  }

  stats(event: DosugEvent, participants: Participant[]): EventStats {
    return computeEventStats(event, participants);
  }

  /** Вес вопросов и итоговый способ ответа: нужен карточкам и мастеру. */
  questionnaire(event: DosugEvent): {
    weight: number;
    mode: AnswerMode;
    effectiveMode: EffectiveAnswerMode;
  } {
    return {
      weight: questionnaireWeight(event.fields),
      mode: event.answerMode,
      effectiveMode: resolveAnswerMode(event.fields, event.answerMode),
    };
  }
}
