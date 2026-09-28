import type {
  DosugEvent,
  EventItem,
  ItemWithReservation,
  Participant,
  Reservation,
  Template,
  TransferRequest,
  UserProfile,
} from '../../domain/types.js';
import { normalizeFields } from '../../domain/questionnaire.js';
import { toIso, toIsoOrNull, toNumberOrNull } from '../mappers.js';
import type { StoredUserProfile } from './store.js';

/**
 * Помощники хранилища в памяти: время, сортировка по датам и приведение
 * сущностей к доменному виду — те же правила, что в SQL-репозиториях.
 */

/** Текущее время в том же виде, в каком его отдаёт PostgreSQL — ISO-строка UTC. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Сортировка по ISO-времени. При равных значениях порядок сохраняется
 * (сортировка в JS стабильна), поэтому результат воспроизводим.
 */
export const sortByTime = <T>(items: T[], pick: (item: T) => string, order: 'asc' | 'desc' = 'asc'): T[] => {
  const sign = order === 'asc' ? 1 : -1;
  return items.sort((a, b) => sign * (Date.parse(pick(a)) - Date.parse(pick(b))));
};

/** Приводит событие к доменному виду так же, как `mapEvent` в SQL-репозитории. */
export const mapEvent = (event: DosugEvent): DosugEvent => ({
  ...event,
  placeCoords: event.placeCoords
    ? { lat: Number(event.placeCoords.lat), lon: Number(event.placeCoords.lon) }
    : null,
  limit: toNumberOrNull(event.limit),
  fields: normalizeFields(event.fields),
  answerMode: event.answerMode ?? 'auto',
});

export const mapParticipant = (participant: Participant): Participant => ({
  ...participant,
  username: participant.username ?? null,
  answers: { ...(participant.answers ?? {}) },
  waitlisted: participant.waitlisted ?? false,
  confirmSentAt: toIsoOrNull(participant.confirmSentAt),
  finalSentAt: toIsoOrNull(participant.finalSentAt),
});

/** Собирает позицию списка покупок вместе с бронью — как LEFT JOIN в SQL. */
export const mapItem = (item: EventItem, reservation: Reservation | null): ItemWithReservation => ({
  id: item.id,
  eventId: item.eventId,
  title: item.title,
  position: toNumberOrNull(item.position) ?? 0,
  createdAt: toIso(item.createdAt),
  reservation: reservation
    ? {
        itemId: item.id,
        eventId: reservation.eventId ?? item.eventId,
        userId: reservation.userId,
        userName: reservation.userName ?? '',
        reservedAt: toIso(reservation.reservedAt ?? item.createdAt),
        paidKopecks: toNumberOrNull(reservation.paidKopecks),
        paidAt: toIsoOrNull(reservation.paidAt),
        note: reservation.note ?? '',
      }
    : null,
});

export const mapTemplate = (template: Template): Template => ({
  id: template.id,
  name: template.name,
  fields: Array.isArray(template.fields) ? [...template.fields] : [],
  // Предустановленные шаблоны живут в коде, в памяти лежат только свои.
  builtin: false,
  ownerId: template.ownerId ?? null,
  createdAt: toIso(template.createdAt),
});

export const mapTransfer = (transfer: TransferRequest): TransferRequest => ({
  ...transfer,
  amountKopecks: Number(transfer.amountKopecks),
  notifiedAt: toIsoOrNull(transfer.notifiedAt),
  detailsSentAt: toIsoOrNull(transfer.detailsSentAt),
  paidAt: toIsoOrNull(transfer.paidAt),
  closedAt: toIsoOrNull(transfer.closedAt),
});

export const mapUser = (user: StoredUserProfile): UserProfile => ({
  userId: user.userId,
  name: user.name,
  username: user.username ?? null,
  contact: user.contact,
  bankName: user.bankName,
  paymentHandle: user.paymentHandle,
});
