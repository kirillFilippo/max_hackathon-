import { newFieldId } from '../../domain/ids.js';
import { normalizeField } from '../../domain/questionnaire.js';
import type { AnswerMode, EventField } from '../../domain/types.js';
import type { MiniappField } from '../../miniapp/server.js';
import type { BotSession } from '../session.js';
import type { AppDeps } from '../deps.js';
import { fieldsEditor, templateFieldsEditor } from '../texts/event.js';

/**
 * Связка «мини-приложение → черновик мастера».
 *
 * Конструктор вопросов живёт в отдельном процессе-странице и не знает, в каком
 * чате открыт мастер: он присылает вопросы с одноразовой подписью, а мы находим
 * активный черновик организатора, обновляем его и присылаем в чат новый экран.
 */
export type QuestionDraft = Extract<
  NonNullable<BotSession['draft']>,
  { kind: 'create-event' | 'edit-template' | 'new-template' }
>;

const isQuestionDraft = (draft: BotSession['draft']): draft is QuestionDraft =>
  Boolean(draft && (draft.kind === 'create-event' || draft.kind === 'edit-template' || draft.kind === 'new-template'));

/** Активные черновики вопросов пользователя: событие, набор или правка набора. */
export const activeQuestionDrafts = async (
  deps: AppDeps,
  userId: number,
): Promise<Array<{ key: string; draft: QuestionDraft }>> => {
  const sessions = await deps.sessions.findByUser(userId);
  return sessions
    .map(({ key, value }) => ({ key, draft: value.draft }))
    .filter((entry): entry is { key: string; draft: QuestionDraft } => isQuestionDraft(entry.draft));
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
  userId: number,
): Promise<DraftQuestionnaire | null> => {
  const [entry] = await activeQuestionDrafts(deps, userId);
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
  userId: number,
  fields: MiniappField[],
  answerMode: AnswerMode,
  name = '',
): Promise<void> => {
  const [entry] = await activeQuestionDrafts(deps, userId);
  if (!entry) {
    deps.logger.warn(`Черновик вопросов не найден (пользователь ${userId}) — вопросы из приложения не сохранены`);
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

  const chatId = Number(key.split(':')[1]);
  if (Number.isFinite(chatId)) {
    // Событие и набор вопросов показывают разные экраны: у набора нет способа ответа,
    // а «Готово» мастера события сохранило бы набор не тем действием.
    const content = draft.kind === 'create-event'
      ? fieldsEditor(draft.fields, [], answerMode)
      : templateFieldsEditor(draft.name ?? '', draft.fields);
    try {
      await deps.notifier.sendToUser(chatId, content);
    } catch (error) {
      deps.logger.warn(`Не удалось обновить экран вопросов в чате ${chatId}`, error);
    }
  }

  deps.logger.info(`Вопросы из мини-приложения сохранены (пользователь ${userId}, вопросов ${fields.length})`);
};
