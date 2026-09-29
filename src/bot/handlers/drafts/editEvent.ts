import { parseLimit, parseUserDateTime } from '../../../domain/datetime/index.js';
import { addressWarning, normalizePlace } from '../../../domain/maps.js';
import { show, userText, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import {
  cancelRow,
  cb,
  escapeMarkdown,
  mapLink,
  withKeyboard,
  withMarkdownKeyboard,
} from '../../message.js';
import type { DraftState } from '../../session.js';
import { placeConfirm, placePrompt } from '../../texts/event/index.js';
import { cbEventCard, cbRegStatus } from '../../callbacks.js';
import { findEventByIdOrNotify, isOrganizerOf, notifyParticipants, refuseNotOrganizer } from '../helpers.js';
import { callbackArgs } from './fieldsScreen.js';

export type EditEventDraft = Extract<DraftState, { kind: 'edit-event' }>;

const FIELD_PROMPTS: Record<EditEventDraft['fieldName'], string> = {
  title: 'Новое название события?',
  startsAt: 'Новая дата и время?',
  place: 'Новое место встречи?',
  description: 'Новое описание события?',
  limit: 'Новый лимит участников?\n\nНапишите число или «нет», чтобы снять лимит.',
};

export const startEditField = async (
  ctx: BotContext,
  deps: AppDeps,
  eventId: string,
  fieldName: EditEventDraft['fieldName'],
): Promise<void> => {
  // Права проверяются ещё и здесь: черновик правки не должен появиться у того,
  // кто не организатор, даже если кнопка пришла из старого сообщения.
  const event = await findEventByIdOrNotify(ctx, deps, eventId);
  if (!event) return;
  if (!isOrganizerOf(ctx, event)) {
    await refuseNotOrganizer(ctx);
    return;
  }
  if (!ctx.session) return;
  ctx.session.draft = {
    kind: 'edit-event',
    step: 'value',
    eventId,
    fieldName,
    fieldType: 'text',
  };
  await show(
    ctx,
    fieldName === 'place'
      ? placePrompt()
      : withKeyboard(FIELD_PROMPTS[fieldName], cancelRow),
  );
};

export const handleEditEventDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: EditEventDraft,
): Promise<boolean> => {
  const event = await findEventByIdOrNotify(ctx, deps, draft.eventId);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    return true;
  }

  const isCallback = ctx.updateType === 'message_callback';
  const { action, args } = callbackArgs(ctx);
  const input = userText(ctx);

  const applyEdit = async (patch: Record<string, unknown>): Promise<void> => {
    const { event: updated, changes } = await deps.events.update(event.id, patch);
    if (ctx.session) ctx.session.draft = null;

    if (changes.length > 0) {
      const notified = await notifyParticipants(
        deps,
        updated,
        withMarkdownKeyboard(
          [
            `Организатор изменил событие «${escapeMarkdown(updated.title)}»`,
            ...changes.map((change) => `  ${escapeMarkdown(change)}`),
            '',
            `Адрес: ${mapLink(updated.place, updated.placeCoords)}`,
            'Проверьте, всё ли в силе.',
          ].join('\n'),
          [
            [
              cb('Иду', cbRegStatus(updated.code, 'going')),
              cb('Не смогу', cbRegStatus(updated.code, 'not_going')),
            ],
          ],
        ),
      );
      deps.logger.info(`Изменения события ${updated.code} отправлены: ${notified}`);
    }
    await show(
      ctx,
      withKeyboard(`Изменения сохранены: ${changes.length > 0 ? changes.join('; ') : 'без изменений'}.`, [
        [cb('К событию', cbEventCard(updated.code))],
      ]),
    );
  };

  if (draft.step === 'place-confirm') {
    if (isCallback && action === 'draft' && args[0] === 'place' && args[1] === 'retry') {
      draft.step = 'value';
      await show(ctx, placePrompt());
      return true;
    }
    if (isCallback && action === 'draft' && args[0] === 'place' && args[1] === 'ok') {
      await applyEdit({
        place: draft.pendingPlace ?? event.place,
        placeCoords: null,
      });
      return true;
    }
    await show(ctx, placeConfirm(draft.pendingPlace ?? event.place, null, null));
    return true;
  }

  if (!input) {
    await show(
      ctx,
      draft.fieldName === 'place'
        ? placePrompt()
        : withKeyboard(FIELD_PROMPTS[draft.fieldName], cancelRow),
    );
    return true;
  }

  switch (draft.fieldName) {
    case 'startsAt': {
      const parsed = parseUserDateTime(input, { tz: deps.config.appTz });
      if (!parsed) {
        await show(ctx, withKeyboard('Не получилось разобрать дату.\n\nФорматы: «завтра в 11:00», «25.10 18:30», «25 октября 19:00».', cancelRow));
        return true;
      }
      await applyEdit({ startsAt: parsed.date.toISOString() });
      return true;
    }
    case 'limit': {
      const limit = parseLimit(input);
      if (limit === undefined) {
        await show(ctx, withKeyboard('Нужно число участников или «нет».', cancelRow));
        return true;
      }
      await applyEdit({ limit });
      return true;
    }
    case 'place': {
      draft.pendingPlace = normalizePlace(input);
      draft.step = 'place-confirm';
      await show(ctx, placeConfirm(draft.pendingPlace, null, addressWarning(draft.pendingPlace)));
      return true;
    }
    case 'title':
      await applyEdit({ title: input.slice(0, 120) });
      return true;
    case 'description':
    default:
      await applyEdit({ description: input.slice(0, 1000) });
      return true;
  }
};
