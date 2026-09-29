import {
  formatDateTime,
  parseLimit,
  parseUserDateTime,
  parseUserTime,
  tzParts,
  zonedToUtc,
} from '../../../../domain/datetime/index.js';
import { addressWarning, normalizePlace } from '../../../../domain/maps.js';
import { questionnaireFingerprint } from '../../../../domain/questionnaire.js';
import { show, userText, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cancelRow, withKeyboard } from '../../../message.js';
import { createSummary, placeConfirm, placePrompt } from '../../../texts/event/index.js';
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
  promptTime,
  promptLimit,
  promptSaveTemplate,
  promptTemplate,
  promptTitle,
} from './prompts.js';

/** Переход к выбору места: с подписью «Когда», чтобы организатор видел дату. */
const goToPlace = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: CreateEventDraft,
  date: Date,
): Promise<void> => {
  draft.step = 'place';
  const prompt = placePrompt();
  await show(ctx, {
    text: `Когда: ${formatDateTime(date, deps.config.appTz)}\n\n${prompt.text}`,
    keyboard: prompt.keyboard,
  });
};

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
      // Время не указали — не придумываем за организатора, а спрашиваем отдельно.
      if (!parsed.hadTime) {
        const parts = tzParts(parsed.date, deps.config.appTz);
        // Дату запоминаем как «полночь выбранного дня», чтобы не показывать 19:00.
        draft.data.pendingDate = zonedToUtc(parts.year, parts.month, parts.day, 0, 0, deps.config.appTz)
          .toISOString();
        draft.data.startsAt = draft.data.pendingDate;
        draft.step = 'time';
        await show(ctx, promptTime(new Date(draft.data.pendingDate), deps.config.appTz));
        return true;
      }

      draft.data.startsAt = parsed.date.toISOString();

      await goToPlace(ctx, deps, draft, parsed.date);
      return true;
    }

    case 'time': {
      // «Пропустить» оставляет время не заданным — покажем это в сводке.
      if (isCallback && args[0] === 'skip') {
        draft.data.startsAt = undefined;
        draft.step = 'place';
        await show(ctx, placePrompt());
        return true;
      }

      const time = parseUserTime(input);
      if (!time) {
        await show(
          ctx,
          withKeyboard('Не понял время. Напишите, например, «19:00» или «в 11».', cancelRow),
        );
        return true;
      }

      // Дату берём из черновика: на этом шаге меняем только часы и минуты.
      const base = draft.data.pendingDate ?? new Date().toISOString();
      const parts = tzParts(new Date(base), deps.config.appTz);
      const at = zonedToUtc(
        parts.year,
        parts.month,
        parts.day,
        time.hour,
        time.minute,
        deps.config.appTz,
      );
      draft.data.startsAt = at.toISOString();
      draft.data.pendingDate = undefined;
      await goToPlace(ctx, deps, draft, at);
      return true;
    }

    case 'place': {
      // Адрес вводится только текстом: кнопку геопозиции убрали, чтобы мастер
      // не зависел от того, сумеет ли клиент прислать точку.
      if (!input) {
        await show(ctx, placePrompt());
        return true;
      }
      draft.data.place = normalizePlace(input);
      draft.data.placeCoords = null;
      draft.step = 'place-confirm';
      await show(ctx, placeConfirm(draft.data.place, null, addressWarning(draft.data.place)));
      return true;
    }

    case 'place-confirm': {
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
