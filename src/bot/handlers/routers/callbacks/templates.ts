import type { ParticipantStatus } from '../../../../domain/types.js';
import { type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import {
  confirmDeleteTemplate,
  deleteTemplate,
  showTemplate,
  showTemplates,
} from '../../features/templates.js';
import { startTemplateCreate, startTemplateEdit, startTemplateRename } from '../../drafts/templates.js';


export const handleTemplate = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
const [sub, ...rest] = args;
const templateId = rest.join(':');
switch (sub) {
  case 'use':
    await showTemplate(ctx, deps, templateId);
    return;
  case 'rename':
    await startTemplateRename(ctx, deps, templateId);
    return;
  case 'edit':
    await startTemplateEdit(ctx, deps, templateId);
    return;
  case 'delete':
    await confirmDeleteTemplate(ctx, deps, templateId);
    return;
  case 'delok':
    await deleteTemplate(ctx, deps, templateId);
    return;
  case 'new':
    await startTemplateCreate(ctx, deps);
    return;
  default:
    await showTemplates(ctx, deps);
}
return;
};
