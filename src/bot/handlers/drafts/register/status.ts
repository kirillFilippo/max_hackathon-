import { formatDateTime } from '../../../../domain/datetime.js';
import { type ParticipantStatus } from '../../../../domain/types.js';
import { replyTo, show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cb, text, withKeyboard } from '../../../message.js';
import type { DraftState, RegisterStep } from '../../../session.js';
import { participantEventCard } from '../../../texts/event.js';
import { resolveAnswerMode } from '../../../../domain/questionnaire.js';
import { buildAnswersUrl } from '../../../callbacks.js';
import { statusRow } from '../../../texts/registration.js';
import { eventViewOptions } from '../../features/events.js';
import {
  botUsernameOf,
  findEventOrNotify,
  menuRow,
  notifyParticipants,
  requireUser,
} from '../../helpers.js';
import { contactPrompt } from '../../../texts/registration.js';
import { renderConfirm } from './screens.js';

export const quickStatusChange = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
  status: ParticipantStatus,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  const user = requireUser(ctx);
  const existing = await deps.participants.find(event.id, user.user_id);

  if (existing) {
    const result = await deps.participants.setStatus(event, user.user_id, status);
    if (!result) {
      await show(ctx, withKeyboard('Не удалось обновить статус.', menuRow));
      return;
    }
    const eventItems = await deps.items.list(event.id);
    const username = botUsernameOf(ctx, deps);
    await show(ctx, participantEventCard(event, result.participant, {
      ...eventViewOptions(ctx, deps),
      answersUrl: resolveAnswerMode(event.fields, event.answerMode) === 'miniapp' && username
        ? buildAnswersUrl(username, event.code)
        : undefined,
    }, eventItems.length));

    if (result.releasedItems.length > 0) {
      await replyTo(
        ctx,
        withKeyboard(
          `Освобождены ваши позиции из списка покупок: ${result.releasedItems.map((item) => item.title).join(', ')}.`,
          [[cb('Список покупок', `shop:show:${event.code}`)]],
        ),
      );
      await notifyParticipants(
        deps,
        event,
        text(
          `Освободились позиции в списке покупок по событию «${event.title}»: `
            + `${result.releasedItems.map((item) => item.title).join(', ')}.`,
        ),
      );
    }

    if (result.promoted) {
      try {
        await deps.notifier.sendToUser(
          result.promoted.userId,
          withKeyboard(
            [
              `Освободилось место на событие «${event.title}»`,
              `Когда: ${formatDateTime(event.startsAt, deps.config.appTz)}`,
              'Вы переведены из листа ожидания в участники. Подтвердите, что придёте.',
            ].join('\n'),
            statusRow(event.code, { compact: true }),
          ),
        );
      } catch (error) {
        deps.logger.warn('Не удалось уведомить участника из листа ожидания', error);
      }
    }
    return;
  }

  // Заявки ещё нет: уточняем контакт, дальше — вопросы или подтверждение.
  if (!ctx.session) return;
  ctx.session.draft = {
    kind: 'register',
    step: status === 'not_going' ? 'confirm' : 'contact',
    data: {
      eventCode: event.code,
      participantName: user.name,
      status,
      answers: {},
      fieldIndex: 0,
    },
  };
  ctx.session.lastEventCode = event.code;

  if (status === 'not_going') {
    await renderConfirm(ctx, deps, event, ctx.session.draft.data);
  } else {
    await show(ctx, contactPrompt(event));
  }
};

/**
 * Какие `reg:*`-кнопки принадлежат мастеру регистрации на текущем шаге.
 *
 * Мастер не должен забирать чужие кнопки: «Иду» из напоминания, статус из карточки
 * участника или «Изменить ответы» — это не шаги мастера. Раньше любой `reg:*`
 * перехватывался черновиком, и нажатие «Иду» в напоминании просто перерисовывало
 * шаг мастера: подтвердить участие было невозможно, пока черновик не закрыт.
 */
