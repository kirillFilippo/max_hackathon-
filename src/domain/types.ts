/**
 * Доменные типы продукта. Слой не зависит ни от MAX SDK, ни от базы данных:
 * его можно тестировать и переиспользовать.
 */

export type ParticipantStatus = 'going' | 'maybe' | 'not_going' | 'pending';

export const PARTICIPANT_STATUSES: ParticipantStatus[] = ['going', 'maybe', 'not_going'];

export const STATUS_LABELS: Record<ParticipantStatus, string> = {
  going: 'Иду',
  maybe: 'Под вопросом',
  not_going: 'Не иду',
  pending: 'Не ответил',
};

export type FieldType = 'text' | 'number' | 'choice' | 'yesno' | 'date';

export const FIELD_TYPES: FieldType[] = ['text', 'number', 'choice', 'yesno', 'date'];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Текст',
  number: 'Число',
  choice: 'Выбор из вариантов',
  yesno: 'Да / Нет',
  date: 'Дата',
};

/**
 * Вопрос анкеты. Ограничения ответа — как в формах: обязательность, границы
 * числа, максимальная длина текста, один или несколько вариантов с границами.
 */
export interface EventField {
  id: string;
  label: string;
  type: FieldType;
  /** Варианты для type === 'choice'. */
  options: string[];
  /** choice: можно выбрать несколько вариантов. */
  multiple: boolean;
  /** choice: минимум и максимум выбранных вариантов. */
  minSelected: number | null;
  maxSelected: number | null;
  /** number: границы значения. */
  min: number | null;
  max: number | null;
  /** text: максимальная длина. */
  maxLength: number | null;
  /** По умолчанию вопрос обязательный, организатор может снять галочку. */
  required: boolean;
}

/**
 * Как участники отвечают на анкету:
 *  - auto   — по весу вопросов (лёгкая в чате, тяжёлая в мини-приложении);
 *  - chat   — всегда в чате;
 *  - miniapp — всегда в мини-приложении.
 * Организатор может переопределить автоматический выбор.
 */
export type AnswerMode = 'auto' | 'chat' | 'miniapp';

export type EffectiveAnswerMode = 'chat' | 'miniapp';

export type EventStatus = 'published' | 'closed';

export interface PlaceCoords {
  lat: number;
  lon: number;
}

export interface DosugEvent {
  id: string;
  /** Короткий код для ссылки-приглашения и ручного ввода. */
  code: string;
  title: string;
  description: string;
  /** ISO-строка начала (UTC). */
  startsAt: string;
  place: string;
  placeCoords: PlaceCoords | null;
  /** null — без ограничения. */
  limit: number | null;
  fields: EventField[];
  /** Режим анкеты: авто по весу, чат или мини-приложение. */
  answerMode: AnswerMode;
  status: EventStatus;
  organizerId: number;
  organizerName: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** Позиция списка покупок. */
export interface EventItem {
  id: string;
  eventId: string;
  title: string;
  position: number;
  createdAt: string;
}

/**
 * Бронь позиции: одна позиция — максимум одна бронь (это гарантирует
 * первичный ключ reservations.item_id в базе).
 */
export interface Reservation {
  itemId: string;
  eventId: string;
  userId: number;
  userName: string;
  reservedAt: string;
  /** Фактически потраченная сумма, которую вводит участник после покупки. */
  paidKopecks: number | null;
  paidAt: string | null;
  note: string;
}

export interface ItemWithReservation extends EventItem {
  reservation: Reservation | null;
}

export interface Participant {
  id: string;
  eventId: string;
  userId: number;
  name: string;
  username: string | null;
  contact: string;
  status: ParticipantStatus;
  /** Ответы на кастомные поля: fieldId → значение. */
  answers: Record<string, string>;
  /** true, если мест больше нет и участник в листе ожидания. */
  waitlisted: boolean;
  confirmSentAt: string | null;
  finalSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  fields: EventField[];
  /** true для предустановленных шаблонов. */
  builtin: boolean;
  /** Для пользовательских шаблонов — id организатора. */
  ownerId: number | null;
  createdAt: string;
}

/** Профиль пользователя: переживает перезапуск бота и деплой (хранится в БД). */
export interface UserProfile {
  userId: number;
  name: string;
  username: string | null;
  contact: string;
  /** Банк для перевода, например «Тинькофф». */
  bankName: string;
  /** Номер телефона / счёт / ник для перевода. */
  paymentHandle: string;
}

/** Как участник собирается закрыть долг. */
export type TransferMode = 'unset' | 'transfer' | 'in_person';

export type TransferStatus =
  /** Запрос создан и отправлен должнику. */
  | 'pending'
  /** Должник отправил реквизиты, они переданы получателю. */
  | 'details_sent'
  /** Договорились отдать при встрече. */
  | 'in_person'
  /** Должник отметил перевод. */
  | 'paid'
  /** Получатель подтвердил получение. */
  | 'closed';

export interface TransferRequest {
  id: string;
  eventId: string;
  fromUserId: number;
  toUserId: number;
  amountKopecks: number;
  mode: TransferMode;
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
  notifiedAt: string | null;
  detailsSentAt: string | null;
  paidAt: string | null;
  closedAt: string | null;
}

export interface EventStats {
  going: number;
  maybe: number;
  notGoing: number;
  pending: number;
  waitlisted: number;
  limit: number | null;
  free: number | null;
  confirmedShare: number;
}

/** Строка списка покупок в расчёте. */
export interface SettlementItem {
  id: string;
  title: string;
  reservedByUserId: number | null;
  reservedByName: string | null;
  paidKopecks: number | null;
}
