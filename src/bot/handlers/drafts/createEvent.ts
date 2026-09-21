import { DEFAULT_TIME, formatDateTime, parseLimit, parseUserDateTime } from '../../../domain/datetime.js';
import { addressWarning, normalizePlace } from '../../../domain/maps.js';
import type { DraftState } from '../../session.js';
import { CB, cbDraftTemplate, cbEventLink, parseCallback } from '../../callbacks.js';
import { replyTo, show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import {
  cancelRow,
  cb,
  chunk,
  truncate,
  withKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../message.js';
import { createSummary, placeConfirm, placePrompt, organizerEventCard } from '../../texts/event.js';
import { answerModeScreen, openQuestionsApp, renderFieldsScreen } from '../questions.js';
import { eventViewOptions } from '../features/events.js';
import { botUsernameOf, menuRow, userIdOf } from '../helpers.js';

export type CreateEventDraft = Extract<DraftState, { kind: 'create-event' }>;


const promptTitle = (): MessageContent =>
  withKeyboard('Новое событие\n\nШаг 1 из 6. Как назовём событие?', cancelRow);

const promptDatetime = (): MessageContent =>
  withKeyboard(
    'Шаг 2 из 6. Когда встречаемся?\n\nНапишите дату и время сообщением.',
    cancelRow,
  );

const promptDescription = (): MessageContent =>
  withKeyboard(
    'Шаг 4 из 6. Описание для участников.\n\nМожно пропустить.',
    [[cb('Пропустить', CB.draftSkip)], ...cancelRow],
  );

const promptLimit = (): MessageContent =>
  withKeyboard(
    'Шаг 5 из 6. Сколько участников ждём?\n\nНапишите число или «нет», если без ограничения.',
    [[cb('Без ограничения', CB.draftSkip)], ...cancelRow],
  );

const promptTemplate = async (deps: AppDeps, userId: number): Promise<MessageContent> => {
  const options = await deps.templates.options(userId);
  const rows: KeyboardRows = chunk(options, 2).map((pair) =>
    pair.map((option) => cb(truncate(option.name, 22), cbDraftTemplate(option.id))),
  );
  rows.push([cb('Без вопросов', CB.draftTemplateNone), cb('Свои вопросы', CB.draftTemplateOwn)]);
  rows.push(...cancelRow);
  return withKeyboard(
    [
      'Шаг 6 из 6. Вопросы участникам.',
      '',
      'Выберите готовый набор или продолжайте без вопросов.',
      'Дальше вопросы собираются в мини-приложении: типы и ограничения ответов задаются там.',
    ].join('\n'),
    rows,
  );
};

const promptSaveTemplate = (): MessageContent =>
  withKeyboard(
    [
      'Сохранить эти вопросы как шаблон?',
      '',
      'Шаблон пригодится для следующих событий: не придётся заводить вопросы заново.',
      'Отправьте название шаблона или нажмите «Не сохранять».',
    ].join('\n'),
    [[cb('Не сохранять', CB.draftSkip)]],
  );

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

const publish = async (ctx: BotContext, deps: AppDeps, draft: CreateEventDraft): Promise<void> => {
  const user = ctx.user;
  if (!user || !draft.data.title || !draft.data.startsAt || !draft.data.place) {
    await show(ctx, withKeyboard('Черновик потерялся, начните заново.', menuRow));
    return;
  }

  const event = await deps.events.create({
    title: draft.data.title,
    description: draft.data.description ?? '',
    startsAt: draft.data.startsAt,
    place: draft.data.place,
    placeCoords: draft.data.placeCoords ?? null,
    limit: draft.data.limit ?? null,
    fields: draft.fields,
    answerMode: draft.data.answerMode ?? 'auto',
    organizerId: user.user_id,
    organizerName: user.name,
  });

  if (ctx.session) {
    ctx.session.draft = null;
    ctx.session.lastEventCode = event.code;
  }

  const options = eventViewOptions(ctx, deps);
  await show(ctx, organizerEventCard(event, deps.events.stats(event, []), options, 0));

  const link = deps.events.inviteLink(event, botUsernameOf(ctx, deps));
  await replyTo(
    ctx,
    link
      ? withKeyboard(
          [
            'Отправьте участникам ссылку-приглашение:',
            link,
            '',
            `Код события: ${event.code}. Если ссылку неудобно пересылать, участник может отправить боту /join ${event.code}.`,
            'Адрес и карта — в разделе «Доп. информация» карточки события.',
          ].join('\n'),
          [[cb('Показать ссылку ещё раз', cbEventLink(event.code))]],
        )
      : withKeyboard(
          `Событие создано. Код для участников: ${event.code}. Пусть отправят боту /join ${event.code}.`,
          [[cb('К событию', `ev:card:${event.code}`)]],
        ),
  );
};

export const handleCreateEventDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: CreateEventDraft,
): Promise<boolean> => {
  const isCallback = ctx.updateType === 'message_callback';
  const { action, args } = isCallback
    ? parseCallback(ctx.callback?.payload ?? '')
    : { action: '', args: [] as string[] };
  const input = ctx.message?.body.text?.trim() ?? '';

  if (isCallback && action === 'draft' && args[0] === 'back') {
    draft.step = 'fields';
    await renderFieldsScreen(ctx, deps, draft);
    return true;
  }

  switch (draft.step) {
    case 'title': {
      if (!input) {
        await show(ctx, promptTitle());
        return true;
      }
      draft.data.title = input.slice(0, 120);
      draft.step = 'datetime';
      await show(ctx, promptDatetime());
      return true;
    }

    case 'datetime': {
      const parsed = parseUserDateTime(input, { tz: deps.config.appTz });
      if (!parsed) {
        await show(
          ctx,
          withKeyboard(
            'Не получилось разобрать дату.\n\nПодойдут форматы: «завтра 19:00», «25.10 18:30», «25 октября 19:00».',
            cancelRow,
          ),
        );
        return true;
      }
      draft.data.startsAt = parsed.date.toISOString();
      draft.step = 'place';
      const note = parsed.hadTime
        ? ''
        : `\n\nВремя не указано, поставил ${DEFAULT_TIME.hour}:00. Если нужно другое, нажмите «Отмена» и создайте событие заново.`;
      const prompt = placePrompt();
      await show(ctx, {
        text: `Когда: ${formatDateTime(parsed.date, deps.config.appTz)}${note}\n\n${prompt.text}`,
        keyboard: prompt.keyboard,
      });
      return true;
    }

    case 'place': {
      const location = ctx.location;
      if (location) {
        const coords = { lat: location.latitude, lon: location.longitude };
        draft.data.placeCoords = coords;
        draft.data.place = draft.data.place ?? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`;
        draft.step = 'place-confirm';
        await show(ctx, placeConfirm(draft.data.place, coords, null));
        return true;
      }
      if (!input) {
        await show(ctx, placePrompt());
        return true;
      }
      draft.data.place = normalizePlace(input);
      draft.data.placeCoords = draft.data.placeCoords ?? null;
      draft.step = 'place-confirm';
      await show(ctx, placeConfirm(draft.data.place, draft.data.placeCoords ?? null, addressWarning(draft.data.place)));
      return true;
    }

    case 'place-confirm': {
      const location = ctx.location;
      if (location) {
        const coords = { lat: location.latitude, lon: location.longitude };
        draft.data.placeCoords = coords;
        await show(ctx, placeConfirm(draft.data.place ?? `${coords.lat}, ${coords.lon}`, coords, null));
        return true;
      }
      if (isCallback && action === 'draft' && args[0] === 'place' && args[1] === 'retry') {
        draft.data.place = undefined;
        draft.data.placeCoords = null;
        draft.step = 'place';
        await show(ctx, placePrompt());
        return true;
      }
      if (isCallback && action === 'draft' && args[0] === 'place' && args[1] === 'ok') {
        draft.step = 'description';
        await show(ctx, promptDescription());
        return true;
      }
      await show(ctx, placeConfirm(draft.data.place ?? '', draft.data.placeCoords ?? null, null));
      return true;
    }

    case 'description': {
      if (isCallback && args[0] === 'skip') {
        draft.data.description = '';
      } else if (input) {
        draft.data.description = input.slice(0, 1000);
      } else {
        await show(ctx, promptDescription());
        return true;
      }
      draft.step = 'limit';
      await show(ctx, promptLimit());
      return true;
    }

    case 'limit': {
      if (isCallback && args[0] === 'skip') {
        draft.data.limit = null;
      } else {
        const limit = parseLimit(input);
        if (limit === undefined) {
          await show(ctx, withKeyboard('Нужно число участников или «нет».', cancelRow));
          return true;
        }
        draft.data.limit = limit;
      }
      draft.step = 'template';
      await show(ctx, await promptTemplate(deps, userIdOf(ctx)));
      return true;
    }

    case 'template': {
      if (!isCallback || action !== 'draft' || args[0] !== 'template') {
        await show(ctx, await promptTemplate(deps, userIdOf(ctx)));
        return true;
      }
      const templateId = args.slice(1).join(':');
      if (templateId === 'none') {
        draft.fields = [];
        draft.data.templateId = null;
        draft.step = 'confirm';
        await show(ctx, createSummary(draft.data, draft.fields, eventViewOptions(ctx, deps)));
        return true;
      }
      if (templateId === 'own') {
        draft.fields = [];
        draft.data.templateId = null;
        draft.step = 'fields';
        // Вопросы собираются только в мини-приложении.
        await openQuestionsApp(ctx, deps, draft);
        return true;
      }
      draft.fields = await deps.templates.fieldsFor(templateId, userIdOf(ctx));
      draft.data.templateId = templateId;
      draft.step = 'fields';
      await openQuestionsApp(ctx, deps, draft);
      return true;
    }

    case 'fields': {
      // Вопросы собираются только в мини-приложении: в чате — вход в конструктор и способ ответа.
      if (isCallback && action === 'app' && args[0] === 'questions') {
        await openQuestionsApp(ctx, deps, draft);
        return true;
      }
      if (isCallback && action === 'q' && args[0] === 'mode') {
        await show(ctx, answerModeScreen('draft', draft.fields, draft.data.answerMode ?? 'auto'));
        return true;
      }
      if (isCallback && action === 'q' && args[0] === 'set') {
        const requested = args[2];
        if (requested === 'auto' || requested === 'chat' || requested === 'miniapp') {
          draft.data.answerMode = requested;
        }
        await renderFieldsScreen(ctx, deps, draft);
        return true;
      }
      if (isCallback && action === 'draft' && args[0] === 'skip') {
        draft.step = 'confirm';
        await show(ctx, createSummary(draft.data, draft.fields, eventViewOptions(ctx, deps)));
        return true;
      }
      await renderFieldsScreen(ctx, deps, draft);
      return true;
    }

    case 'save-template': {
      if (isCallback && args[0] === 'skip') {
        draft.data.saveTemplateName = null;
      } else if (input) {
        const template = await deps.templates.createFromFields(userIdOf(ctx), input.slice(0, 60), draft.fields);
        draft.data.saveTemplateName = template.name;
      } else {
        await show(ctx, promptSaveTemplate());
        return true;
      }
      draft.step = 'confirm';
      const saved = draft.data.saveTemplateName
        ? `\n\nШаблон «${draft.data.saveTemplateName}» сохранён: его можно выбрать при следующем создании.`
        : '';
      const summary = createSummary(draft.data, draft.fields, {
        ...eventViewOptions(ctx, deps),
        answerMode: draft.data.answerMode ?? 'auto',
      });
      await show(ctx, { ...summary, text: `${summary.text}${saved}` });
      return true;
    }

    case 'confirm':
    default: {
      if (isCallback && action === 'draft' && args[0] === 'publish') {
        await publish(ctx, deps, draft);
        return true;
      }
      if (isCallback && action === 'draft' && args[0] === 'skip') {
        draft.step = 'fields';
        await renderFieldsScreen(ctx, deps, draft);
        return true;
      }
      await show(ctx, createSummary(draft.data, draft.fields, {
        ...eventViewOptions(ctx, deps),
        answerMode: draft.data.answerMode ?? 'auto',
      }));
      return true;
    }
  }
};
