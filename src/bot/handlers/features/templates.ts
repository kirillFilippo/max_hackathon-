import { CB } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import { templateCard, templatesList } from '../../texts/event.js';
import { menuRow, userIdOf } from '../helpers.js';

export const showTemplates = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const ownerId = userIdOf(ctx);
  const custom = await deps.templates.custom(ownerId);
  await show(ctx, templatesList(custom, deps.templates.presets()));
};

export const showTemplate = async (
  ctx: BotContext,
  deps: AppDeps,
  templateId: string,
): Promise<void> => {
  const template = await deps.templates.find(templateId, userIdOf(ctx));
  if (!template) {
    await show(ctx, withKeyboard('Шаблон не найден: возможно, он удалён.', menuRow));
    return;
  }
  await show(ctx, templateCard(template));
};

export const confirmDeleteTemplate = async (
  ctx: BotContext,
  deps: AppDeps,
  templateId: string,
): Promise<void> => {
  const template = await deps.templates.find(templateId, userIdOf(ctx));
  if (!template || template.builtin) {
    await show(ctx, withKeyboard('Предустановленный шаблон удалить нельзя.', [[cb('К шаблонам', CB.menuTemplates)]]));
    return;
  }
  await show(
    ctx,
    withKeyboard(
      `Удалить шаблон «${template.name}»?\n\nСобытия, созданные с ним, не изменятся.`,
      [
        [cb('Удалить', `tpl:delok:${template.id}`), cb('Оставить', `tpl:use:${template.id}`)],
      ],
    ),
  );
};

export const deleteTemplate = async (
  ctx: BotContext,
  deps: AppDeps,
  templateId: string,
): Promise<void> => {
  const ownerId = userIdOf(ctx);
  const template = await deps.templates.find(templateId, ownerId);
  if (!template || template.builtin) {
    await show(ctx, withKeyboard('Этот шаблон удалить нельзя.', [[cb('К шаблонам', CB.menuTemplates)]]));
    return;
  }
  await deps.templates.remove(templateId, ownerId);
  await show(
    ctx,
    withKeyboard(`Шаблон «${template.name}» удалён.`, [[cb('К шаблонам', CB.menuTemplates)]]),
  );
};
