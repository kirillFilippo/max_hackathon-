import { CB, parseCallback } from '../../callbacks.js';
import { show, userText, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cancelRow, cb, withKeyboard } from '../../message.js';
import type { DraftState } from '../../session.js';
import { cbQuestionsApp } from '../../callbacks.js';
import { templateCard, templateFieldsEditor } from '../../texts/event.js';
import { handleFieldsScreenInput } from './fieldsScreen.js';
import { menuRow, userIdOf } from '../helpers.js';

export type RenameTemplateDraft = Extract<DraftState, { kind: 'rename-template' }>;
export type EditTemplateDraft = Extract<DraftState, { kind: 'edit-template' }>;
export type NewTemplateDraft = Extract<DraftState, { kind: 'new-template' }>;

/** Создание набора вопросов прямо из меню «Наборы вопросов». */
export const startTemplateCreate = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  if (!ctx.session) return;
  ctx.session.draft = { kind: 'new-template', step: 'name', fields: [], editor: null };
  await show(
    ctx,
    withKeyboard(
      [
        'Новый набор вопросов',
        '',
        'Как назвать набор? Название увидите вы — участникам оно не показывается.',
      ].join('\n'),
      cancelRow,
    ),
  );
};

export const handleNewTemplateDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: NewTemplateDraft,
): Promise<boolean> => {
  const isCallback = ctx.updateType === 'message_callback';
  const { action, args } = isCallback
    ? parseCallback(ctx.callback?.payload ?? '')
    : { action: '', args: [] as string[] };

  if (draft.step === 'name') {
    const input = userText(ctx);
    if (!input) {
      await show(
        ctx,
        withKeyboard('Напишите название набора — например, «Настольная игра».', cancelRow),
      );
      return true;
    }
    draft.name = input.slice(0, 60);
    draft.step = 'fields';
    await show(ctx, templateFieldsEditor(draft.name, draft.fields));
    return true;
  }

  if (!draft.editor && isCallback && action === 'draft' && args[0] === 'skip') {
    const name = (draft.name ?? '').trim() || 'Набор вопросов';
    if (draft.fields.length === 0) {
      await show(
        ctx,
        withKeyboard('В наборе нет ни одного вопроса — добавьте хотя бы один.', [
          [cb('Добавить вопрос', CB.draftFieldAdd)],
          [cb('Конструктор в приложении', cbQuestionsApp('draft'))],
          ...cancelRow,
        ]),
      );
      return true;
    }
    const created = await deps.templates.createFromFields(userIdOf(ctx), name, draft.fields);
    if (ctx.session) ctx.session.draft = null;
    await show(ctx, templateCard(created));
    return true;
  }

  const handled = await handleFieldsScreenInput(ctx, deps, draft, action, args);
  if (!handled) await show(ctx, templateFieldsEditor(draft.name ?? '', draft.fields));
  return true;
};

export const startTemplateRename = async (
  ctx: BotContext,
  deps: AppDeps,
  templateId: string,
): Promise<void> => {
  const template = await deps.templates.find(templateId, userIdOf(ctx));
  if (!template || template.builtin) {
    await show(ctx, withKeyboard('Предустановленный шаблон переименовать нельзя.', [
      [cb('К шаблонам', CB.menuTemplates)],
    ]));
    return;
  }
  if (!ctx.session) return;
  ctx.session.draft = { kind: 'rename-template', step: 'name', templateId };
  await show(ctx, withKeyboard(`Новое название для шаблона «${template.name}»?`, [
    [cb('Отмена', CB.draftCancel)],
  ]));
};

export const handleRenameTemplateDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: RenameTemplateDraft,
): Promise<boolean> => {
  const input = userText(ctx);
  if (!input) {
    await show(ctx, withKeyboard('Напишите новое название шаблона.', cancelRow));
    return true;
  }
  const renamed = await deps.templates.rename(draft.templateId, userIdOf(ctx), input.slice(0, 60));
  if (ctx.session) ctx.session.draft = null;
  if (!renamed) {
    await show(ctx, withKeyboard('Шаблон не найден: возможно, он удалён.', menuRow));
    return true;
  }
  await show(ctx, templateCard(renamed));
  return true;
};

export const startTemplateEdit = async (
  ctx: BotContext,
  deps: AppDeps,
  templateId: string,
): Promise<void> => {
  const template = await deps.templates.find(templateId, userIdOf(ctx));
  if (!template || template.builtin) {
    await show(ctx, withKeyboard('Предустановленный шаблон изменить нельзя. Создайте свой при создании события.', [
      [cb('К шаблонам', CB.menuTemplates)],
    ]));
    return;
  }
  if (!ctx.session) return;
  ctx.session.draft = {
    kind: 'edit-template',
    templateId: template.id,
    name: template.name,
    fields: deps.templates.copyFields(template.fields),
    editor: null,
  };
  await show(ctx, templateFieldsEditor(template.name, ctx.session.draft.fields));
};

export const handleEditTemplateDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: EditTemplateDraft,
): Promise<boolean> => {
  const isCallback = ctx.updateType === 'message_callback';
  const { action, args } = isCallback
    ? parseCallback(ctx.callback?.payload ?? '')
    : { action: '', args: [] as string[] };

  if (!draft.editor && isCallback && action === 'draft' && args[0] === 'skip') {
    const updated = await deps.templates.updateFields(draft.templateId, userIdOf(ctx), draft.fields);
    if (ctx.session) ctx.session.draft = null;
    if (!updated) {
      await show(ctx, withKeyboard('Шаблон не найден: возможно, он удалён.', menuRow));
      return true;
    }
    await show(ctx, templateCard(updated));
    return true;
  }

  // Шаги редактора вопросов, добавление, удаление, вход в мини-приложение.
  const handled = await handleFieldsScreenInput(ctx, deps, draft, action, args);
  if (!handled) await show(ctx, templateFieldsEditor(draft.name, draft.fields));
  return true;
};
