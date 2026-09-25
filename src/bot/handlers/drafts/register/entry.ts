import { formatDateTime } from '../../../../domain/datetime.js';
import { STATUS_LABELS } from '../../../../domain/types.js';
import { cbEventCard } from '../../../callbacks.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cb, withKeyboard } from '../../../message.js';
import type { DraftState, RegisterStep } from '../../../session.js';
import { invitationCard, participantEventCard } from '../../../texts/event.js';
import { resolveAnswerMode } from '../../../../domain/questionnaire.js';
import { buildAnswersUrl } from '../../../callbacks.js';
import { answerFormCard } from '../../../texts/registration.js';
import { eventViewOptions } from '../../features/events.js';
import {
  botUsernameOf,
  findEventOrNotify,
  menuRow,
  requireUser,
  userIdOf,
} from '../../helpers.js';
import { namePrompt } from '../../../texts/registration.js';
import { renderConfirm, renderField } from './screens.js';

export const startRegistration = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
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

  // Нового участника не тащим сразу в мастер: на одну ссылку уходило два
  // сообщения (карточка и первый шаг). Сначала приглашение с кнопкой «Записаться».
  const participants = await deps.participants.listByEvent(event.id);
  if (ctx.session) ctx.session.lastEventCode = event.code;
  await show(
    ctx,
    invitationCard(event, deps.events.stats(event, participants), {
      ...eventViewOptions(ctx, deps),
      answersUrl: effectiveMode === 'miniapp' && username
        ? buildAnswersUrl(username, event.code)
        : undefined,
    }),
  );
};

/**
 * Начало мастера регистрации: приглашение уже показано, спрашиваем имя.
 * Отдельная функция, потому что приглашение и мастер — два разных сообщения.
 */
export const beginRegistration = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
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

  // Заявка уже есть — открываем её на изменение, а не заводим вторую.
  const existing = await deps.participants.find(event.id, user.user_id);
  if (existing) {
    await startEditRegistration(ctx, deps, code);
    return;
  }

  if (ctx.session) {
    ctx.session.draft = {
      kind: 'register',
      step: 'name',
      data: { eventCode: event.code, answers: {}, fieldIndex: 0 },
    };
    ctx.session.lastEventCode = event.code;
  }
  const profile = await deps.profiles.get(user.user_id);
  await show(ctx, namePrompt(event, profile?.name || user.name));
};

/**
 * «Всё верно, отправить» без активного черновика: сессия могла истечь, а сообщение
 * с кнопкой — остаться в чате. Раньше кнопка молчала; теперь показываем состояние
 * заявки или запускаем мастер заново.
 */
export const confirmRegistrationButton = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  if (!code) {
    await show(
      ctx,
      withKeyboard(
        'Кнопка устарела: черновик заявки не сохранился. Откройте ссылку-приглашение или отправьте /join.',
        menuRow,
      ),
    );
    return;
  }

  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;

  const user = requireUser(ctx);
  const existing = await deps.participants.find(event.id, user.user_id);
  if (existing) {
    await show(
      ctx,
      withKeyboard(
        `Заявка на «${event.title}» уже принята. Статус: ${STATUS_LABELS[existing.status]}.`,
        [[cb('К событию', cbEventCard(event.code))], ...menuRow],
      ),
    );
    return;
  }

  await show(
    ctx,
    withKeyboard('Черновик заявки потерян — заполним заново, это быстро.', menuRow),
  );
  await beginRegistration(ctx, deps, code);
};

/** Повторное открытие заявки с подстановкой прошлых ответов. */
export const startEditRegistration = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
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
