import { parseCallback } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { CB } from '../../callbacks.js';
import type { AnswerMode } from '../../../domain/types.js';
import { cb, withKeyboard } from '../../message.js';
import type { FieldEditorState } from '../../session.js';
import { fieldsEditor } from '../../texts/event.js';
import { userText } from '../../context.js';
import { answerModeScreen, openQuestionsApp, type QuestionsHost } from '../questions.js';
import { MAX_FIELDS, handleFieldEditorCallback, handleFieldEditorText, renderEditorScreen, startFieldEditor } from './editor.js';

/**
 * Общая обработка экрана вопросов для всех мастеров, где вопросы редактируются
 * в чате: создание события, набор из меню, правка существующего набора.
 *
 * Обрабатывает шаги редактора вопроса, добавление и удаление, вход в мини-приложение.
 * Переход «дальше» каждый мастер обрабатывает сам.
 */
export interface FieldsHost extends QuestionsHost {
  /** Шаг мастера: обработчику экрана вопросов он не важен. */
  step?: string;
}

/** Возвращает true, если действие относится к экрану вопросов и обработано. */
export const handleFieldsScreenInput = async (
  ctx: BotContext,
  deps: AppDeps,
  host: FieldsHost,
  action: string,
  args: string[],
): Promise<boolean> => {
  const isCallback = ctx.updateType === 'message_callback';
  // Текст берём только из сообщения пользователя: у нажатия кнопки в message
  // лежит текст экрана, и его нельзя принимать за ответ.
  const input = userText(ctx);

  // Шаги редактора вопроса (текст → тип → ограничения → обязательность).
  if (host.editor) {
    const consumed = isCallback
      ? handleFieldEditorCallback(host, action, args)
      : handleFieldEditorText(host, input);
    // Пока редактор открыт, показываем его экран; когда вопрос добавлен,
    // редактор закрывается — тогда мастер перерисует список вопросов.
    if (!consumed || host.editor) {
      if (host.editor) await show(ctx, renderEditorScreen(host.editor));
      return true;
    }
    return false;
  }

  if (isCallback && action === 'app' && args[0] === 'questions') {
    await openQuestionsApp(ctx, deps, host);
    return true;
  }

  // «Способ ответа на анкету» — скрытая настройка черновика события.
  // У набора вопросов режима нет: там кнопки нет, но старое сообщение могло её сохранить.
  if (isCallback && action === 'q') {
    const [sub, scope = 'draft', value = ''] = args;
    // Возврат к списку вопросов обрабатывает сам мастер: он перерисует свой экран.
    if (sub === 'back') return false;
    if (!host.data) {
      await show(
        ctx,
        withKeyboard('Способ ответа настраивается у события, а не у набора вопросов.', [
          [cb('К вопросам', CB.draftSkip)],
        ]),
      );
      return true;
    }
    if (sub === 'mode') {
      await show(ctx, answerModeScreen(scope, host.fields, host.data.answerMode ?? 'auto'));
      return true;
    }
    if (sub === 'set' && (value === 'auto' || value === 'chat' || value === 'miniapp')) {
      host.data.answerMode = value as AnswerMode;
      // false — список вопросов перерисует мастер, которому принадлежит черновик.
      return false;
    }
    return true;
  }

  if (isCallback && action === 'draft' && args[0] === 'field' && args[1] === 'add') {
    if (host.fields.length >= MAX_FIELDS) {
      await show(
        ctx,
        withKeyboard(`Больше ${MAX_FIELDS} вопросов добавлять не стоит.`, [
          [cb('Готово', CB.draftSkip)],
        ]),
      );
      return true;
    }
    await show(ctx, startFieldEditor(host));
    return true;
  }

  if (isCallback && action === 'draft' && args[0] === 'fieldpreset') {
    const label = args.slice(1).join(':').trim();
    if (label) {
      const { normalizeField } = await import('../../../domain/questionnaire.js');
      const { newFieldId } = await import('../../../domain/ids.js');
      host.fields.push(normalizeField({ id: newFieldId(), label: label.slice(0, 140), type: 'text' }));
    }
    return false;
  }

  if (isCallback && action === 'draft' && args[0] === 'fieldremove') {
    const index = Number(args[1]);
    if (Number.isInteger(index) && index >= 0 && index < host.fields.length) {
      host.fields.splice(index, 1);
    }
    return false;
  }

  return false;
};

/** Достаёт действие и аргументы кнопки. */
export const callbackArgs = (ctx: BotContext): { action: string; args: string[] } =>
  ctx.updateType === 'message_callback'
    ? parseCallback(ctx.callback?.payload ?? '')
    : { action: '', args: [] };

/** Экран вопросов для черновика: список, подсказки, кнопки. */
export const renderFields = async (
  ctx: BotContext,
  deps: AppDeps,
  host: FieldsHost & { data?: { answerMode?: string | null; templateId?: string | null } },
  suggestions: string[],
): Promise<void> => {
  await show(ctx, fieldsEditor(host.fields, suggestions, (host.data?.answerMode ?? 'auto') as never));
};

export type { FieldEditorState };
export { fieldsEditor };
