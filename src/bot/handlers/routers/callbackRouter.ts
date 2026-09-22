import type { ParticipantStatus } from '../../../domain/types.js';
import { parseCallback } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, withKeyboard } from '../../message.js';
import { answerModeScreen } from '../questions.js';
import { helpText } from '../../texts/common.js';
import { showFaq, answerFaqKey } from '../features/faq.js';
import {
  closeEvent,
  openEventForParticipant,
  remindNow,
  showEventCard,
  showEventDetails,
  showEventList,
  showInviteLink,
  showParticipants,
  showMainMenu,
} from '../features/events.js';
import {
  markTransferInPerson,
  markTransferPaid,
  markTransferReceived,
  requestTransfers,
  showDuties,
  showSettlement,
  startTransferDetails,
} from '../features/money.js';
import { showProfile, startContactDraft, startPaymentDraft } from '../features/profile.js';
import {
  notifyShoppingList,
  releaseItem,
  showMyItems,
  showShoppingList,
  takeItem,
} from '../features/shopping.js';
import {
  confirmDeleteTemplate,
  deleteTemplate,
  showTemplate,
  showTemplates,
} from '../features/templates.js';
import { startCreateEvent } from '../drafts/createEvent.js';
import { startAddItems, startItemPrice, startReserveNumbers } from '../drafts/items.js';
import { startEditField } from '../drafts/editEvent.js';
import { startTemplateCreate, startTemplateEdit, startTemplateRename } from '../drafts/templates.js';
import { quickStatusChange, startEditRegistration, startRegistration } from '../drafts/register.js';
import { editMenu } from '../../texts/event.js';
import { menuRow } from '../helpers.js';

/** Обработка кнопок вне активного мастера. */
export const handleCallback = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  if (ctx.updateType !== 'message_callback') return;
  const { action, args } = parseCallback(ctx.callback?.payload ?? '');

  switch (action) {
    case 'menu': {
      switch (args[0]) {
        case 'events':
          await showEventList(ctx, deps);
          return;
        case 'templates':
          await showTemplates(ctx, deps);
          return;
        case 'faq':
          await showFaq(ctx, deps);
          return;
        case 'help':
          await show(ctx, helpText());
          return;
        case 'profile':
          await showProfile(ctx, deps);
          return;
        case 'duties':
          await showDuties(ctx, deps);
          return;
        default:
          await showMainMenu(ctx, deps);
      }
      return;
    }

    case 'ev': {
      const [sub, code = '', extra = ''] = args;
      switch (sub) {
        case 'new':
          await startCreateEvent(ctx, deps);
          return;
        case 'list':
          await showEventList(ctx, deps);
          return;
        case 'card': {
          const event = await deps.events.findByCode(code);
          if (event && event.organizerId !== ctx.user?.user_id) {
            await openEventForParticipant(ctx, deps, code);
            return;
          }
          await showEventCard(ctx, deps, code);
          return;
        }
        case 'people':
          await showParticipants(ctx, deps, code);
          return;
        case 'link':
          await showInviteLink(ctx, deps, code);
          return;
        case 'info':
          await showEventDetails(ctx, deps, code);
          return;
        case 'edit': {
          const event = await deps.events.findByCode(code);
          if (!event) {
            await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
            return;
          }
          await show(ctx, editMenu(event));
          return;
        }
        case 'set': {
          const event = await deps.events.findByCode(code);
          if (!event) {
            await show(ctx, withKeyboard(`Событие ${code} не найдено.`, menuRow));
            return;
          }
          await startEditField(ctx, deps, event.id, extra as 'title' | 'startsAt' | 'place' | 'description' | 'limit');
          return;
        }
        case 'remind':
          await remindNow(ctx, deps, code);
          return;
        case 'close':
          await closeEvent(ctx, deps, code);
          return;
        default:
          return;
      }
    }

    case 'shop': {
      const [sub, code = ''] = args;
      switch (sub) {
        case 'show':
          await showShoppingList(ctx, deps, code);
          return;
        case 'mine':
          await showMyItems(ctx, deps, code);
          return;
        case 'add':
          await startAddItems(ctx, deps, code);
          return;
        case 'reserve':
          await startReserveNumbers(ctx, deps, code);
          return;
        case 'notify':
          await notifyShoppingList(ctx, deps, code);
          return;
        default:
          return;
      }
    }

    case 'item': {
      const [sub, code = '', itemId = ''] = args;
      if (sub === 'take') {
        await takeItem(ctx, deps, code, itemId);
        return;
      }
      if (sub === 'release') {
        await releaseItem(ctx, deps, code, itemId);
        return;
      }
      if (sub === 'price') {
        await startItemPrice(ctx, deps, code, itemId);
      }
      return;
    }

    case 'money': {
      const [sub, code = ''] = args;
      if (sub === 'show') {
        await showSettlement(ctx, deps, code);
        return;
      }
      if (sub === 'request') {
        await requestTransfers(ctx, deps, code);
      }
      return;
    }

    case 'tr': {
      const [sub, requestId = ''] = args;
      switch (sub) {
        case 'details':
          await startTransferDetails(ctx, deps, requestId);
          return;
        case 'person':
          await markTransferInPerson(ctx, deps, requestId);
          return;
        case 'paid':
          await markTransferPaid(ctx, deps, requestId);
          return;
        case 'received':
          await markTransferReceived(ctx, deps, requestId);
          return;
        default:
          return;
      }
    }

    case 'profile': {
      if (args[0] === 'contact') {
        await startContactDraft(ctx, deps);
        return;
      }
      if (args[0] === 'payment') {
        await startPaymentDraft(ctx, deps);
      }
      return;
    }

    case 'tpl': {
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
    }

    case 'reg': {
      const [sub, code = '', status = ''] = args;
      if (sub === 'start') {
        await startRegistration(ctx, deps, code);
        return;
      }
      if (sub === 'change') {
        await startEditRegistration(ctx, deps, code);
        return;
      }
      if (sub === 'status') {
        await quickStatusChange(ctx, deps, code, status as ParticipantStatus);
      }
      return;
    }

    case 'q': {
      // «Способ ответа на анкету» для опубликованного события: скрытая настройка,
      // которую организатор может переопределить.
      const [sub, scope = '', mode = ''] = args;
      if (scope === 'draft') return;
      const event = await deps.events.findByCode(scope);
      if (!event) {
        await show(ctx, withKeyboard(`Событие ${scope} не найдено.`, menuRow));
        return;
      }
      if (event.organizerId !== ctx.user?.user_id) {
        await show(ctx, withKeyboard('Менять способ ответа может только организатор.', menuRow));
        return;
      }
      if (sub === 'mode') {
        await show(ctx, answerModeScreen(event.code, event.fields, event.answerMode));
        return;
      }
      if (sub === 'set' && (mode === 'auto' || mode === 'chat' || mode === 'miniapp')) {
        await deps.events.update(event.id, { answerMode: mode });
        await showEventCard(ctx, deps, event.code);
        return;
      }
      return;
    }

    case 'app': {
      await show(
        ctx,
        withKeyboard(
          'Конструктор вопросов открывается из мастера создания события или из шаблона.',
          [[cb('Создать событие', 'ev:new')]],
        ),
      );
      return;
    }

    case 'faq': {
      if (args[0] === 'q' && args[1]) {
        await answerFaqKey(ctx, deps, args[1]);
        return;
      }
      if (args[0] === 'ev' && args[1] && args[2]) {
        await answerFaqKey(ctx, deps, args[2], args[1]);
        return;
      }
      await showFaq(ctx, deps);
      return;
    }

    default:
      await showMainMenu(ctx, deps);
  }
};
