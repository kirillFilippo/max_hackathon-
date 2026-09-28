import type { DraftState } from '../../../session.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';



import { promptTitle } from './prompts.js';

export const startCreateEvent = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  if (!ctx.session) return;
  ctx.session.draft = {
    kind: 'create-event',
    step: 'title',
    data: { templateId: null, saveTemplateName: null },
    fields: [],
    editor: null,
  };
  await show(ctx, promptTitle());
};
