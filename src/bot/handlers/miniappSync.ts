import { newFieldId } from '../../domain/ids.js';
import { normalizeField } from '../../domain/questionnaire.js';
import type { AnswerMode, EventField } from '../../domain/types.js';
import type { MiniappField, MiniappTicket } from '../../miniapp/server.js';
import type { BotSession } from '../session.js';
import type { AppDeps } from '../deps.js';
import { fieldsEditor, templateFieldsEditor } from '../texts/event/index.js';

/**
 * Связка «мини-приложение → черновик мастера».
 *
 * Конструктор вопросов живёт отдельной страницей и не знает, в каком чате открыт
 * мастер. Он присылает вопросы с одноразовым пропуском, в котором записано, кто и
 * из какой сессии его открыл: по сессии находим нужный черновик (у пользователя их
 * может быть несколько — по одному на чат), а по чату возвращаем экран обратно.
 */
export type QuestionDraft = Extract<
  NonNullable<BotSession['draft']>,
  { kind: 'create-event' | 'edit-template' | 'new-template' }
>;

const isQuestionDraft = (draft: BotSession['draft']): draft is QuestionDraft =>
  Boolean(draft && (draft.kind === 'create-event' || draft.kind === 'edit-template' || draft.kind === 'new-template'));

/**
 * Черновик вопросов из сессии пропуска.
 *
 * Сессию берём по ключу напрямую: пропуск выдан из конкретного чата, поэтому
 * перебирать все сессии пользователя не нужно и нельзя — иначе вопросы уехали бы
 * в чужой черновик.
 */
const findQuestionDraft = async (
  deps: AppDeps,
  ticket: MiniappTicket,
): Promise<{ key: string; draft: QuestionDraft } | null> => {
  const session = await deps.sessions.get(ticket.sessionKey);
  const draft = session?.draft;
  return isQuestionDraft(draft) ? { key: ticket.sessionKey, draft } : null;
};

export interface DraftQuestionnaire {
  fields: MiniappField[];
  answerMode: AnswerMode;
  name: string;
}

const toMiniappField = (field: EventField): MiniappField => ({
  label: field.label,
  type: field.type,
  options: field.options,
  multiple: field.multiple,
  minSelected: field.minSelected,
  maxSelected: field.maxSelected,
  min: field.min,
  max: field.max,
  maxLength: field.maxLength,
  required: field.required,
});

/** Что показать в конструкторе: текущие вопросы, режим ответа и название набора. */
export const readDraftQuestionnaire = async (
  deps: AppDeps,
  ticket: MiniappTicket,
): Promise<DraftQuestionnaire | null> => {
  const entry = await findQuestionDraft(deps, ticket);
  if (!entry) return null;
  const { draft } = entry;
  const data = draft.kind === 'create-event' ? draft.data : undefined;
  return {
    fields: draft.fields.map(toMiniappField),
    answerMode: data?.answerMode ?? 'auto',
    name: draft.kind === 'create-event' ? (data?.saveTemplateName ?? '') : (draft.name ?? ''),
  };
};

/**
 * Применяет вопросы из конструктора: обновляет черновик и присылает в чат новый
 * экран вопросов. Название набора сохраняем, чтобы не спрашивать его повторно.
 */
export const applyMiniappFields = async (
  deps: AppDeps,
  ticket: MiniappTicket,
  fields: MiniappField[],
  answerMode: AnswerMode,
  name = '',
): Promise<void> => {
  const entry = await findQuestionDraft(deps, ticket);
  if (!entry) {
    deps.logger.warn(
      `Черновик вопросов не найден (сессия ${ticket.sessionKey}) — вопросы из приложения не сохранены`,
    );
    throw new Error('Черновик вопросов не найден');
  }

  const { key, draft } = entry;
  draft.fields = fields.map((field) => normalizeField({ ...field, id: newFieldId() }));
  draft.editor = null;

  if (draft.kind === 'create-event') {
    draft.data = {
      ...draft.data,
      answerMode,
      saveTemplateName: name || draft.data.saveTemplateName || null,
    };
  } else if (draft.kind === 'new-template' && name) {
    draft.name = name;
  }

  const session = await deps.sessions.get(key);
  await deps.sessions.set(key, { ...(session ?? {}), draft: draft as BotSession['draft'] });

  // Событие и набор вопросов показывают разные экраны: у набора нет способа ответа,
  // а «Готово» мастера события сохранило бы набор не тем действием.
  const content = draft.kind === 'create-event'
    ? fieldsEditor(draft.fields, answerMode)
    : templateFieldsEditor(draft.name ?? '', draft.fields);
  try {
    // Чат берём из пропуска: в личном диалоге MAX он совпадает с пользователем,
    // но полагаться на это нельзя — сообщение адресуется чату.
    await deps.notifier.sendToChat(ticket.chatId, content);
  } catch (error) {
    deps.logger.warn(`Не удалось обновить экран вопросов в чате ${ticket.chatId}`, error);
  }

  deps.logger.info(
    `Вопросы из мини-приложения сохранены (пользователь ${ticket.userId}, вопросов ${fields.length})`,
  );
};
