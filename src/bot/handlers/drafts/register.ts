import { formatDateTime } from '../../../domain/datetime.js';
import { STATUS_LABELS, type DosugEvent, type ParticipantStatus } from '../../../domain/types.js';
import { CB, cbEventCard, cbRegStatus, parseCallback } from '../../callbacks.js';
import { validateAnswer } from '../../../domain/validation.js';
import { replyTo, show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, text, withKeyboard } from '../../message.js';
import type { DraftState } from '../../session.js';
import { invitationCard, participantEventCard } from '../../texts/event.js';
import { resolveAnswerMode } from '../../../domain/questionnaire.js';
import { buildAnswersUrl } from '../../callbacks.js';
import { answerFormCard, registrationNotice } from '../../texts/registration.js';
import { eventViewOptions } from '../features/events.js';
import { botUsernameOf, menuRow, notifyParticipants, requireUser, userIdOf } from '../helpers.js';
import {
  contactPrompt,
  namePrompt,
  registerFieldPrompt,
  registerSummary,
  statusPrompt,
} from '../../texts/registration.js';

export type RegisterDraft = Extract<DraftState, { kind: 'register' }>;

const renderConfirm = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  data: RegisterDraft['data'],
): Promise<void> => {
  await show(ctx, registerSummary(event, data, { tz: deps.config.appTz }));
};

const renderField = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  draft: RegisterDraft,
): Promise<void> => {
  const field = event.fields[draft.data.fieldIndex];
  if (!field) {
    draft.step = 'confirm';
    await renderConfirm(ctx, deps, event, draft.data);
    return;
  }
  const selected = (draft.data.answers[field.id] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  await show(ctx, registerFieldPrompt(field, draft.data.fieldIndex, event.fields.length, selected));
};

const goToFieldsOrConfirm = async (
  ctx: BotContext,
  deps: AppDeps,
  event: DosugEvent,
  draft: RegisterDraft,
): Promise<void> => {
  if (draft.data.status === 'not_going' || event.fields.length === 0) {
    draft.step = 'confirm';
    await renderConfirm(ctx, deps, event, draft.data);
    return;
  }
  draft.step = 'fields';
  draft.data.fieldIndex = 0;
  await renderField(ctx, deps, event, draft);
};

const saveRegistration = async (
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

  if (ctx.session) {
    ctx.session.draft = null;
    ctx.session.lastEventCode = event.code;
  }

  const items = await deps.items.list(event.id);
  await show(ctx, participantEventCard(event, result.participant, eventViewOptions(ctx, deps), items.length));

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
export const startRegistration = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие с кодом ${code} не найдено.`, menuRow));
    return;
  }
  if (event.status === 'closed') {
    await show(
      ctx,
      withKeyboard(
        `Событие «${event.title}» (${formatDateTime(event.startsAt, deps.config.appTz)}) уже завершено.`,
        menuRow,
      ),
    );
    return;
  }

  const user = requireUser(ctx);
  await deps.profiles.touchFromMax(user);

  // Тяжёлую анкету (вес вопросов выше порога) заполняют в мини-приложении:
  // все вопросы на одном экране вместо десятка сообщений в чате.
  const effectiveMode = resolveAnswerMode(event.fields, event.answerMode);
  const username = botUsernameOf(ctx, deps);
  if (effectiveMode === 'miniapp' && deps.miniapp && username) {
    if (ctx.session) ctx.session.lastEventCode = event.code;
    await show(ctx, answerFormCard(event, buildAnswersUrl(username, event.code), { tz: deps.config.appTz }));
    return;
  }

  const [existing, items] = await Promise.all([
    deps.participants.find(event.id, user.user_id),
    deps.items.list(event.id),
  ]);
  if (existing) {
    if (ctx.session) ctx.session.lastEventCode = event.code;
    const username = botUsernameOf(ctx, deps);
    await show(ctx, participantEventCard(event, existing, {
      ...eventViewOptions(ctx, deps),
      answersUrl: effectiveMode === 'miniapp' && username
        ? buildAnswersUrl(username, event.code)
        : undefined,
    }, items.length));
    return;
  }

  const participants = await deps.participants.listByEvent(event.id);
  if (ctx.session) {
    ctx.session.draft = {
      kind: 'register',
      step: 'name',
      data: { eventCode: event.code, answers: {}, fieldIndex: 0 },
    };
    ctx.session.lastEventCode = event.code;
  }
  await replyTo(
    ctx,
    invitationCard(event, deps.events.stats(event, participants), {
      ...eventViewOptions(ctx, deps),
      answersUrl: effectiveMode === 'miniapp' && username
        ? buildAnswersUrl(username, event.code)
        : undefined,
    }),
  );
  const profile = await deps.profiles.get(user.user_id);
  await show(ctx, namePrompt(event, profile?.name || user.name));
};

/** Повторное открытие заявки с подстановкой прошлых ответов. */
export const startEditRegistration = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие с кодом ${code} не найдено.`, menuRow));
    return;
  }
  const userId = userIdOf(ctx);
  const existing = await deps.participants.find(event.id, userId);
  if (!existing || !ctx.session) {
    await startRegistration(ctx, deps, code);
    return;
  }

  ctx.session.draft = {
    kind: 'register',
    step: event.fields.length > 0 ? 'fields' : 'confirm',
    data: {
      eventCode: event.code,
      participantName: existing.name,
      contact: existing.contact,
      status: existing.status,
      answers: { ...existing.answers },
      fieldIndex: 0,
    },
  };
  ctx.session.lastEventCode = event.code;

  if (event.fields.length === 0) {
    await renderConfirm(ctx, deps, event, ctx.session.draft.data);
    return;
  }
  await renderField(ctx, deps, event, ctx.session.draft);
};

/** Быстрая смена статуса (кнопки в карточках и напоминаниях). */
export const quickStatusChange = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
  status: ParticipantStatus,
): Promise<void> => {
  const event = await deps.events.findByCode(code);
  if (!event) {
    await show(ctx, withKeyboard(`Событие с кодом ${code} не найдено.`, menuRow));
    return;
  }
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
            [
              [
                cb('Иду', cbRegStatus(event.code, 'going')),
                cb('Не смогу', cbRegStatus(event.code, 'not_going')),
              ],
            ],
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

/** Шаги мастера регистрации. */
export const handleRegisterDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: RegisterDraft,
): Promise<boolean> => {
  const isCallback = ctx.updateType === 'message_callback';
  const { action, args } = isCallback
    ? parseCallback(ctx.callback?.payload ?? '')
    : { action: '', args: [] as string[] };
  const input = ctx.message?.body.text?.trim() ?? '';

  const event = await deps.events.findByCode(draft.data.eventCode);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    await show(ctx, withKeyboard(`Событие с кодом ${draft.data.eventCode} не найдено.`, menuRow));
    return true;
  }

  if (isCallback && action === 'reg' && args[0] === 'start') {
    draft.step = 'name';
    draft.data.answers = {};
    draft.data.fieldIndex = 0;
    draft.data.status = undefined;
    const profile = await deps.profiles.get(userIdOf(ctx));
    await show(ctx, namePrompt(event, profile?.name ?? ''));
    return true;
  }

  switch (draft.step) {
    case 'name': {
      if (isCallback && action === 'reg' && args[0] === 'name' && args[1] === 'self') {
        const profile = await deps.profiles.get(userIdOf(ctx));
        draft.data.participantName = profile?.name ?? ctx.user?.name ?? '';
      } else if (input) {
        draft.data.participantName = input.slice(0, 80);
      } else {
        const profile = await deps.profiles.get(userIdOf(ctx));
        await show(ctx, namePrompt(event, profile?.name ?? ''));
        return true;
      }
      draft.step = 'contact';
      await show(ctx, contactPrompt(event));
      return true;
    }

    case 'contact': {
      if (isCallback && action === 'reg' && args[0] === 'contact' && args[1] === 'skip') {
        draft.data.contact = '';
      } else {
        const fromContact = ctx.contactInfo?.tel;
        const value = fromContact ?? input;
        if (!value) {
          await show(ctx, contactPrompt(event));
          return true;
        }
        draft.data.contact = value.slice(0, 120);
      }

      if (draft.data.status) {
        await goToFieldsOrConfirm(ctx, deps, event, draft);
        return true;
      }
      draft.step = 'status';
      await show(ctx, statusPrompt(event));
      return true;
    }

    case 'status': {
      if (!isCallback || action !== 'reg' || args[0] !== 'status') {
        await show(ctx, statusPrompt(event));
        return true;
      }
      const status = args[2] as ParticipantStatus | undefined;
      if (!status || !(status in STATUS_LABELS)) {
        await show(ctx, statusPrompt(event));
        return true;
      }
      draft.data.status = status;
      await goToFieldsOrConfirm(ctx, deps, event, draft);
      return true;
    }

    case 'fields': {
      const field = event.fields[draft.data.fieldIndex];
      if (!field) {
        draft.step = 'confirm';
        await renderConfirm(ctx, deps, event, draft.data);
        return true;
      }

      const store = async (value: string): Promise<void> => {
        const validation = validateAnswer(field, value);
        if (!validation.ok) {
          const prompt = registerFieldPrompt(field, draft.data.fieldIndex, event.fields.length);
          await show(ctx, { ...prompt, text: `${validation.error}\n\n${prompt.text}` });
          return;
        }
        draft.data.answers[field.id] = validation.value;
        draft.data.fieldIndex += 1;
        if (draft.data.fieldIndex >= event.fields.length) {
          draft.step = 'confirm';
          await renderConfirm(ctx, deps, event, draft.data);
        } else {
          await renderField(ctx, deps, event, draft);
        }
      };

      if (isCallback && action === 'reg' && args[0] === 'answer') {
        const targetIndex = Number(args[1]);
        const value = args[2] ?? '';
        if (targetIndex !== draft.data.fieldIndex) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        if (value === 'skip') {
          await store('');
          return true;
        }
        if (value === 'done') {
          // Подтверждение мультивыбора: проверить ограничения и перейти дальше.
          await store(draft.data.answers[field.id] ?? '');
          return true;
        }
        if (value === 'yes') {
          await store('Да');
          return true;
        }
        if (value === 'no') {
          await store('Нет');
          return true;
        }
        const option = field.options[Number(value)];
        if (option === undefined) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        await store(option);
        return true;
      }

      // Мультивыбор: кнопки накапливают выбор, «Готово» подтверждает.
      if (isCallback && action === 'reg' && args[0] === 'toggle') {
        const targetIndex = Number(args[1]);
        const optionIndex = Number(args[2]);
        if (targetIndex !== draft.data.fieldIndex || !field.multiple) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        const option = field.options[optionIndex];
        if (option === undefined) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        const current = (draft.data.answers[field.id] ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        const next = current.includes(option)
          ? current.filter((item) => item !== option)
          : [...current, option];
        draft.data.answers[field.id] = next.join(', ');
        await renderField(ctx, deps, event, draft);
        return true;
      }

      if (field.type === 'choice' && !field.multiple) {
        await renderField(ctx, deps, event, draft);
        return true;
      }
      if (!input) {
        await renderField(ctx, deps, event, draft);
        return true;
      }
      await store(input);
      return true;
    }

    case 'confirm':
    default: {
      if (isCallback && action === 'reg' && args[0] === 'confirm') {
        await saveRegistration(ctx, deps, event, draft);
        return true;
      }
      if (isCallback && action === 'reg' && args[0] === 'cancel') {
        if (ctx.session) ctx.session.draft = null;
        await show(ctx, withKeyboard('Заявка отменена. Вернуться можно по ссылке или командой /join.', menuRow));
        return true;
      }
      await renderConfirm(ctx, deps, event, draft.data);
      return true;
    }
  }
};
