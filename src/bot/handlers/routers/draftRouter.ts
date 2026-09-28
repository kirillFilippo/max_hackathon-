import { parseCallback } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import { handleCreateEventDraft } from '../drafts/createEvent.js';
import { handleEditEventDraft } from '../drafts/editEvent.js';
import { handleItemReserveDraft, handleItemsAddDraft } from '../drafts/items.js';
import { handleProfileContactDraft } from '../drafts/profileContact.js';
import { handleRegisterDraft } from '../drafts/register.js';
import { registerDraftOwnsCallback } from '../drafts/register.js';
import {
  handleEditTemplateDraft,
  handleNewTemplateDraft,
  handleRenameTemplateDraft,
} from '../drafts/templates.js';
import { showMainMenu } from '../features/events.js';
import type { DraftState } from '../../session.js';

/** Кнопки, которые обрабатывает сам мастер, а не общий роутер. */
const ownsAction = (draft: DraftState, action: string, args: string[]): boolean => {
  if (action === 'draft') return true;
  // Мастер регистрации берёт только кнопки своего шага: остальные `reg:*`
  // (например, «Иду» из напоминания) обрабатывает общий роутер.
  if (draft.kind === 'register' && action === 'reg') {
    return registerDraftOwnsCallback(draft.step, draft.data.eventCode, args);
  }
  // Вопросы и вход в конструктор мини-приложения — часть мастера события.
  if (
    (draft.kind === 'create-event' || draft.kind === 'edit-template' || draft.kind === 'new-template')
    && (action === 'q' || action === 'app')
  ) {
    return true;
  }
  return false;
};

/**
 * Роутер активного мастера: перехватывает текст и кнопки, пока у пользователя
 * есть незавершённый черновик. Возвращает true, если событие обработано.
 */
export const handleDraft = async (ctx: BotContext, deps: AppDeps): Promise<boolean> => {
  const draft = ctx.session?.draft;
  if (!draft) return false;

  const isCallback = ctx.updateType === 'message_callback';
  const isText = ctx.updateType === 'message_created';
  if (!isCallback && !isText) return false;

  const cancelToMenu = async (): Promise<boolean> => {
    if (ctx.session) ctx.session.draft = null;
    await showMainMenu(ctx, deps);
    return true;
  };

  if (isText) {
    const value = (ctx.message?.body.text ?? '').trim().toLowerCase();
    if (value === 'отмена' || value === 'cancel' || value === 'стоп') return cancelToMenu();
  }

  if (isCallback) {
    const { action, args } = parseCallback(ctx.callback?.payload ?? '');
    if (action === 'draft' && args[0] === 'cancel') return cancelToMenu();
    if (!ownsAction(draft, action, args)) {
      // Пользователь ушёл в другой раздел: «В меню» явно закрывает черновик,
      // остальные кнопки обрабатывает общий роутер, черновик не трогаем.
      if (action === 'menu' && args[0] === 'main' && ctx.session) ctx.session.draft = null;
      return false;
    }
  }

  switch (draft.kind) {
    case 'create-event':
      return handleCreateEventDraft(ctx, deps, draft);
    case 'register':
      return handleRegisterDraft(ctx, deps, draft);
    case 'edit-event':
      return handleEditEventDraft(ctx, deps, draft);
    case 'items-add':
      return handleItemsAddDraft(ctx, deps, draft);
    case 'item-reserve':
      return handleItemReserveDraft(ctx, deps, draft);
    case 'profile-contact':
      return handleProfileContactDraft(ctx, deps, draft);
    case 'rename-template':
      return handleRenameTemplateDraft(ctx, deps, draft);
    case 'edit-template':
      return handleEditTemplateDraft(ctx, deps, draft);
    case 'new-template':
      return handleNewTemplateDraft(ctx, deps, draft);
    default: {
      if (ctx.session) ctx.session.draft = null;
      await show(ctx, withKeyboard('Черновик устарел, начните заново.', [
        [cb('В меню', 'menu:main')],
      ]));
      return true;
    }
  }
};
