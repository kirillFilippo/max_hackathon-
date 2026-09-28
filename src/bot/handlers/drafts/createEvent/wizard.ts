import {
  DEFAULT_TIME,
  formatDateTime,
  parseLimit,
  parseUserDateTime,
} from '../../../../domain/datetime.js';
import { addressWarning, normalizePlace } from '../../../../domain/maps.js';
import { questionnaireFingerprint } from '../../../../domain/questionnaire.js';
import type { DraftState } from '../../../session.js';
import { CB } from '../../../callbacks.js';
import { show, userText, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cancelRow, cb, withKeyboard } from '../../../message.js';
import { createSummary, placeConfirm, placePrompt } from '../../../texts/event.js';
import { renderFieldsScreen } from '../../questions.js';
import { handleFieldsScreenInput } from '../fieldsScreen.js';
import { eventViewOptions } from '../../features/events.js';
import { userIdOf } from '../../helpers.js';
import { callbackArgs } from '../fieldsScreen.js';



import type { CreateEventDraft } from './types.js';
import { publish } from './publish.js';
import {
  promptDatetime,
  promptDescription,
  promptLimit,
  promptSaveTemplate,
  promptTemplate,
  promptTitle,
} from './prompts.js';

export const handleCreateEventDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: CreateEventDraft,
): Promise<boolean> => {
  const isCallback = ctx.updateType === 'message_callback';
  const { action, args } = callbackArgs(ctx);
  const input = userText(ctx);

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
            'Не получилось разобрать дату.\n\nПодойдут форматы: «завтра в 11:00», «25.10 18:30», «25 октября 19:00».',
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
        // Вложение есть, а координат бот не увидел: говорим об этом прямо. Иначе
        // экран молча перерисовывается и это выглядит как «кнопка не работает».
        if ((ctx.message?.body?.attachments?.length ?? 0) > 0) {
          await show(
            ctx,
            withKeyboard(
              'Не разобрал геопозицию. Отправьте точку ещё раз или напишите адрес текстом.',
              [[cb('Отмена', CB.draftCancel)]],
            ),
          );
          return true;
        }
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
        draft.data.templateSnapshot = null;
        draft.step = 'confirm';
        await show(ctx, createSummary(draft.data, draft.fields, eventViewOptions(ctx, deps)));
        return true;
      }
      if (templateId === 'own') {
        draft.fields = [];
        draft.data.templateId = null;
        draft.data.templateSnapshot = null;
        draft.step = 'fields';
        // Экран вопросов: добавляем свои вопросы или собираем их в приложении.
        await renderFieldsScreen(ctx, deps, draft);
        return true;
      }
      draft.fields = await deps.templates.fieldsFor(templateId, userIdOf(ctx));
      draft.data.templateId = templateId;
      // Запоминаем исходный набор: если вопросы не меняли, сохранять шаблон не предлагаем.
      draft.data.templateSnapshot = questionnaireFingerprint(draft.fields);
      draft.step = 'fields';
      await renderFieldsScreen(ctx, deps, draft);
      return true;
    }

    case 'fields': {
      // Пока открыт редактор вопроса, «Дальше» не должно срабатывать.
      if (!draft.editor && isCallback && action === 'draft' && args[0] === 'skip') {
        const fromTemplate = draft.data.templateId;
        const unchanged = Boolean(fromTemplate)
          && draft.data.templateSnapshot === questionnaireFingerprint(draft.fields);
        if (unchanged) {
          // Взяли готовый набор и ничего в нём не поменяли — сохранять нечего.
          draft.step = 'confirm';
          await show(ctx, createSummary(draft.data, draft.fields, {
            ...eventViewOptions(ctx, deps),
            answerMode: draft.data.answerMode ?? 'auto',
          }));
          return true;
        }
        draft.step = 'save-template';
        // Название могло прийти из конструктора вопросов — тогда не спрашиваем его заново.
        await show(ctx, promptSaveTemplate(draft.data.saveTemplateName));
        return true;
      }
      // Шаги редактора, добавление и удаление вопросов, вход в мини-приложение.
      const handled = await handleFieldsScreenInput(ctx, deps, draft, action, args);
      if (!handled) await renderFieldsScreen(ctx, deps, draft);
      return true;
    }

    case 'save-template': {
      if (isCallback && action === 'draft' && args[0] === 'savetpl' && args[1] === 'yes') {
        const name = (draft.data.saveTemplateName ?? '').trim();
        if (!name) {
          await show(ctx, promptSaveTemplate(null));
          return true;
        }
        const template = await deps.templates.createFromFields(userIdOf(ctx), name.slice(0, 60), draft.fields);
        draft.data.saveTemplateName = template.name;
      } else if (isCallback && args[0] === 'skip') {
        draft.data.saveTemplateName = null;
      } else if (input) {
        const template = await deps.templates.createFromFields(userIdOf(ctx), input.slice(0, 60), draft.fields);
        draft.data.saveTemplateName = template.name;
      } else {
        await show(ctx, promptSaveTemplate(draft.data.saveTemplateName));
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
