import {
  ANSWER_MODE_LABELS,
  EFFECTIVE_MODE_LABELS,
  questionnaireWeight,
  resolveAnswerMode,
} from '../../domain/questionnaire.js';
import type { AnswerMode } from '../../domain/types.js';
import { newTicket } from '../../miniapp/server.js';
import { CB, cbEventCard, cbQuestionsModeBack, cbQuestionsModeSet } from '../callbacks.js';
import { show, type BotContext } from '../context.js';
import type { AppDeps } from '../deps.js';
import { button, cb, withKeyboard, type MessageContent } from '../message.js';
import type { EventDraftData, FieldEditorHost } from '../session.js';
import { fieldsEditor } from '../texts/event.js';
import { userIdOf } from './helpers.js';

/**
 * Черновик с вопросами. Способ ответа и выбранный шаблон есть только у события,
 * поэтому здесь достаточно минимального набора полей — подходит и для наборов.
 */
export interface QuestionsHost extends FieldEditorHost {
  data?: Pick<EventDraftData, 'templateId' | 'answerMode'>;
}

/** Подсказки для экрана вопросов: поля выбранного шаблона и частые вопросы. */
export const fieldSuggestions = async (deps: AppDeps, host: QuestionsHost): Promise<string[]> => {
  const used = new Set(host.fields.map((field) => field.label.toLowerCase()));
  const templateId = host.data?.templateId ?? null;
  const fromTemplate = templateId
    ? (await deps.templates.find(templateId, 0))?.fields.map((field) => field.label) ?? []
    : [];
  const common = [
    'Что принесёте с собой?',
    'Нужна помощь, как добраться?',
    'Во сколько удобно прийти?',
    'Есть ограничения по еде?',
    'Контакт для срочной связи',
  ];
  return [...new Set([...fromTemplate, ...common])]
    .filter((label) => !used.has(label.toLowerCase()))
    .slice(0, 4);
};

/** Экран вопросов: список, подсказки, способ ответа, вход в мини-приложение. */
export const renderFieldsScreen = async (
  ctx: BotContext,
  deps: AppDeps,
  host: QuestionsHost,
): Promise<void> => {
  const mode = host.data?.answerMode ?? 'auto';
  await show(ctx, fieldsEditor(host.fields, await fieldSuggestions(deps, host), mode));
};

/**
 * Конструктор вопросов в мини-приложении. Бот выдаёт одноразовый тикет и
 * присылает кнопку: удобнее собирать тяжёлую анкету списком, чем по шагам в чате.
 */
export const openQuestionsApp = async (
  ctx: BotContext,
  deps: AppDeps,
  host: QuestionsHost,
): Promise<void> => {
  if (!deps.miniapp) {
    const fallback = fieldsEditor(host.fields, await fieldSuggestions(deps, host), host.data?.answerMode ?? 'auto');
    await show(ctx, {
      text: [
        'Конструктор вопросов недоступен: мини-приложение не настроено (нет MINIAPP_URL).',
        '',
        fallback.text,
      ].join('\n'),
      keyboard: fallback.keyboard,
    });
    return;
  }

  const ticket = newTicket();
  deps.miniapp.registerTicket(ticket, { userId: userIdOf(ctx), at: Date.now() });
  // В ссылке только подпись: черновик вопросов страница забирает сама.
  const url = deps.miniapp.buildUrl(ticket);

  await show(
    ctx,
    withKeyboard(
      [
        'Конструктор вопросов',
        '',
        'Откройте мини-приложение, соберите вопросы списком и нажмите «Сохранить в бота».',
        'Там же задаются ограничения ответов и название набора для шаблона.',
        'После сохранения вернитесь в чат — вопросы появятся на этом экране.',
      ].join('\n'),
      [[button.openApp('Открыть конструктор', url)], [cb('Вернуться к вопросам', CB.draftSkip)]],
    ),
  );
};

/**
 * Скрытая настройка «где участники отвечают». По умолчанию бот решает по весу
 * вопросов, но организатор может переопределить — как и просили.
 */
export const answerModeScreen = (
  scope: string,
  fields: QuestionsHost['fields'],
  mode: AnswerMode,
): MessageContent => {
  const weight = questionnaireWeight(fields);
  const effective = resolveAnswerMode(fields, mode);
  const labels: Record<AnswerMode, string> = {
    auto: ANSWER_MODE_LABELS.auto,
    chat: ANSWER_MODE_LABELS.chat,
    miniapp: ANSWER_MODE_LABELS.miniapp,
  };
  const rows = (['auto', 'chat', 'miniapp'] as AnswerMode[]).map((value) => [
    cb(`${value === mode ? '• ' : ''}${labels[value]}`, cbQuestionsModeSet(scope, value)),
  ]);
  // Возврат ведёт туда, откуда пришли: у черновика — к списку вопросов, у события — к карточке.
  rows.push([
    scope === 'draft'
      ? cb('Вернуться к вопросам', cbQuestionsModeBack(scope))
      : cb('К событию', cbEventCard(scope)),
  ]);

  return withKeyboard(
    [
      'Способ ответа на анкету',
      '',
      `Вес вопросов: ${weight}, порог 10.`,
      `Сейчас участники отвечают ${EFFECTIVE_MODE_LABELS[effective]}.`,
      '',
      'По умолчанию бот выбирает способ по весу вопросов, но можно задать вручную.',
    ].join('\n'),
    rows,
  );
};

export const questionsAppAvailable = (deps: AppDeps): boolean => deps.miniapp !== null;
