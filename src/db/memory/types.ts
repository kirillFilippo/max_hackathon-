import type {
  DosugEvent,
  EventItem,
  Participant,
  Reservation,
  Template,
  UserProfile,
} from '../../domain/types.js';

/**
 * Формат снимка памяти: версия, снимок и «надгробия» удалений.
 *
 * Лежит отдельно от `store.ts` и `snapshot.ts`, чтобы те не зависели друг от
 * друга: хранилище держит состояние и доступ к нему, `snapshot.ts` умеет это
 * состояние снять и загрузить, а формат читают ещё `resilient/sync.ts` и
 * `resilient/offlineFile.ts`.
 */

/** Версия формата снимка: пригодится, если структура данных поменяется. */
export const MEMORY_SNAPSHOT_VERSION = 1;

/**
 * Профиль вместе со служебными датами. В `UserProfile` их нет, а `createdAt`
 * нужен сервисам (например, чтобы отличить новичка от постоянного гостя).
 */
export interface StoredUserProfile extends UserProfile {
  createdAt: string;
  updatedAt: string;
}

/**
 * Удаления, сделанные без связи.
 *
 * Без них синхронизация не может отличить «брони никогда не было» от «бронь сняли
 * в офлайне»: первое трогать нельзя (в базе её мог создать кто-то ещё), второе
 * обязано доехать. То же с заявками, позициями и наборами: удаление, потерянное
 * при переносе, оставляет мусор в базе навсегда.
 */
export interface MemoryDeletions {
  participants: Array<{ eventId: string; userId: number }>;
  items: string[];
  reservations: string[];
  templates: string[];
}

/** Пустой набор удалений: снимок без этой секции пришёл от версии до её появления. */
export const emptyDeletions = (): MemoryDeletions => ({
  participants: [],
  items: [],
  reservations: [],
  templates: [],
});

/** Снимок состояния: только обычные объекты и массивы — годится для JSON и БД. */
export interface MemorySnapshot {
  version: number;
  events: DosugEvent[];
  participants: Participant[];
  items: EventItem[];
  reservations: Reservation[];
  templates: Template[];
  users: StoredUserProfile[];
  /** Удаления, которые ещё не применены в базе (см. `MemoryDeletions`). */
  deletions: MemoryDeletions;
}
