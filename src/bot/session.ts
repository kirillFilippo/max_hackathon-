import type { AnswerMode, EventField, FieldType, ParticipantStatus } from '../domain/types.js';
import type { PlaceCoords } from '../domain/types.js';

export type CreateEventStep =
  | 'title'
  | 'datetime'
  /** Дата без времени: спрашиваем время отдельным шагом, а не подставляем своё. */
  | 'time'
  | 'place'
  | 'place-confirm'
  | 'description'
  | 'limit'
  | 'template'
  | 'fields'
  | 'save-template'
  | 'confirm';

export interface EventDraftData {
  title?: string;
  startsAt?: string;
  /** Дата без времени: ждём время отдельным шагом (см. шаг `time`). */
  pendingDate?: string;
  place?: string;
  placeCoords?: PlaceCoords | null;
  description?: string;
  limit?: number | null;
  templateId?: string | null;
  /** Отпечаток вопросов выбранного набора: если не изменился — не предлагаем сохранять. */
  templateSnapshot?: string | null;
  saveTemplateName?: string | null;
  /** Как участники отвечают на анкету: авто по весу, чат или мини-приложение. */
  answerMode?: AnswerMode;
}

/**
 * Шаги редактора question: текст → тип → ограничения по типу → обязательность.
 * Ограничения такие же, как в формах: границы числа, длина текста, число
 * выбранных вариантов.
 */
export type FieldEditorStep =
  | 'label'
  | 'type'
  | 'options'
  | 'multiple'
  | 'minSelected'
  | 'maxSelected'
  | 'min'
  | 'max'
  | 'maxLength'
  | 'required';

/** Состояние редактора кастомных полей (общее для события и шаблона). */
export interface FieldEditorState {
  step: FieldEditorStep;
  draft: Partial<EventField>;
}

export interface FieldEditorHost {
  fields: EventField[];
  editor?: FieldEditorState | null;
}

export type RegisterStep = 'name' | 'contact' | 'status' | 'fields' | 'confirm';

export interface RegisterDraftData {
  eventCode: string;
  participantName?: string;
  contact?: string;
  status?: ParticipantStatus;
  answers: Record<string, string>;
  fieldIndex: number;
}

export type EditField = 'startsAt' | 'place' | 'description' | 'title' | 'limit';

export type DraftState =
  | ({ kind: 'create-event'; step: CreateEventStep; data: EventDraftData } & FieldEditorHost)
  | ({ kind: 'edit-template'; templateId: string; name: string } & FieldEditorHost)
  | ({ kind: 'new-template'; step: 'name' | 'fields'; name?: string } & FieldEditorHost)
  | { kind: 'register'; step: RegisterStep; data: RegisterDraftData }
  | { kind: 'rename-template'; step: 'name'; templateId: string }
  | {
    kind: 'edit-event';
    step: 'value' | 'place-confirm';
    eventId: string;
    fieldName: EditField;
    fieldType: FieldType;
    pendingPlace?: string;
    }
  | { kind: 'items-add'; step: 'titles'; eventId: string; eventCode: string }
  | { kind: 'item-reserve'; step: 'numbers'; eventId: string; eventCode: string }
  | { kind: 'profile-contact'; step: 'contact' };

export interface BotSession {
  draft?: DraftState | null;
  /** Последнее событие пользователя — контекст для FAQ. */
  lastEventCode?: string | null;
  /**
   * Событие, список покупок которого пользователь видел последним. Нужен, чтобы
   * «2 3» текстом бронировало позиции, как и обещает подсказка в списке.
   */
  lastShopEventCode?: string | null;
}
