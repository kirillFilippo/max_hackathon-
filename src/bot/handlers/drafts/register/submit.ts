import { STATUS_LABELS, type DosugEvent, type ParticipantStatus } from '../../../../domain/types.js';
import { CB, cbEventCard } from '../../../callbacks.js';
import { replyTo, show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cb, text, withKeyboard } from '../../../message.js';
import type { DraftState, RegisterStep } from '../../../session.js';
import { participantEventCard } from '../../../texts/event.js';
import { registrationNotice } from '../../../texts/registration.js';
import { eventViewOptions } from '../../features/events.js';
import { requireUser } from '../../helpers.js';
import { registerFieldPrompt } from '../../../texts/registration.js';
import type { RegisterDraft } from './screens.js';

export const saveRegistration = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  draft: RegisterDraft,
): Promise<void> => {
  const user = requireUser(ctx);
  const data = draft.data;
  const status: ParticipantStatus = data.status ?? 'going';

  const result = await deps.participants.save({
    event,
    userId: user.user_id,
    name: data.participantName?.trim() || user.name,
    username: user.username ?? null,
    contact: data.contact?.trim() ?? '',
    status,
    answers: data.answers,
  });

  // Ответ не прошёл проверку ограничений: возвращаем участника к этому вопросу.
  if (!result.ok) {
    const index = event.fields.findIndex((field) => field.id === result.failedField.id);
    if (index >= 0) {
      draft.step = 'fields';
      draft.data.fieldIndex = index;
    }
    await show(
      ctx,
      withKeyboard(`${result.error}\n\n${registerFieldPrompt(result.failedField, Math.max(index, 0), event.fields.length).text}`,
        [[cb('Отмена', CB.regCancel)]]),
    );
    return;
  }

  if (data.contact?.trim()) {
    await deps.profiles.saveContact(user.user_id, data.contact.trim());
  }

  // Список покупок читаем до сброса черновика: если чтение упадёт, пользователь
  // не останется «записанным, но без ответов и без возможности их поправить».
  const items = await deps.items.list(event.id);
  await show(ctx, participantEventCard(event, result.participant, eventViewOptions(ctx, deps), items.length));

  if (ctx.session) {
    ctx.session.draft = null;
    ctx.session.lastEventCode = event.code;
  }

  if (result.waitlisted) {
    await replyTo(
      ctx,
      withKeyboard(
        [
          'Мест не осталось, поэтому вы в листе ожидания.',
          'Если кто-то откажется, бот напишет вам и переведёт в участники.',
        ].join('\n'),
        [[cb('Показать событие', cbEventCard(event.code))]],
      ),
    );
  }

  // Организатору — уведомление о новой заявке.
  const notification = registrationNotice(event, {
    name: result.participant.name,
    contact: result.participant.contact,
    statusLabel: STATUS_LABELS[status],
    waitlisted: result.waitlisted,
    answers: result.participant.answers,
  });
  try {
    await deps.notifier.sendToUser(event.organizerId, notification);
  } catch (error) {
    deps.logger.warn('Не удалось уведомить организатора о новой заявке', error);
  }
};

/** Старт мастера регистрации: по ссылке-приглашению, коду или кнопке. */
