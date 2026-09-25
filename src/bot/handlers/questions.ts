import {
  ANSWER_MODE_LABELS,
  EFFECTIVE_MODE_LABELS,
  resolveAnswerMode,
} from '../../domain/questionnaire.js';
import type { AnswerMode } from '../../domain/types.js';
import { newTicket } from '../../miniapp/server.js';
import {
  buildConstructorUrl,
  CB,
  cbEventCard,
  cbQuestionsModeBack,
  cbQuestionsModeSet,
} from '../callbacks.js';
import { show, type BotContext } from '../context.js';
import type { AppDeps } from '../deps.js';
import { button, cb, link, withKeyboard, type KeyboardRows, type MessageContent } from '../message.js';
import type { EventDraftData, FieldEditorHost } from '../session.js';
import { fieldsEditor } from '../texts/event.js';
import { botUsernameOf, userIdOf } from './helpers.js';

/**
 * Черновик с вопросами. Способ ответа и выбранный шаблон есть только у события,
 * поэтому здесь достаточно минимального набора полей — подходит и для наборов.
 */
export interface QuestionsHost extends FieldEditorHost {
  data?: Pick<EventDraftData, 'templateId' | 'answerMode'>;
}

/** Экран вопросов: список, способ ответа, вход в мини-приложение. */
export const renderFieldsScreen = async (
  ctx: BotContext,
  _deps: AppDeps,
  host: QuestionsHost,
): Promise<void> => {
  await show(ctx, fieldsEditor(host.fields, host.data?.answerMode ?? 'auto'));
};

/**
 * Конструктор вопросов в мини-приложении. Бот выдаёт подпись мастера и присылает
 * ссылку на то же мини-приложение, что открывает анкету участника (MAX сам
 * подставляет зарегистрированный адрес), а подпись едет в `start_param`.
 */
export const openQuestionsApp = async (
  ctx: BotContext,
  deps: AppDeps,
  host: QuestionsHost,
): Promise<void> => {
  if (!deps.miniapp) {
    const fallback = fieldsEditor(host.fields, host.data?.answerMode ?? 'auto');
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
  const username = botUsernameOf(ctx, deps);
  const rows: KeyboardRows = [];

  if (username) {
    rows.push([link('Открыть конструктор', buildConstructorUrl(username, ticket))]);
  } else {
    // Ник бота неизвестен — остаётся прямая ссылка на мини-приложение.
    rows.push([button.openApp('Открыть конструктор', deps.miniapp.buildUrl(ticket))]);
  }
  rows.push([cb('Вернуться к вопросам', CB.draftSkip)]);

  await show(
    ctx,
    withKeyboard(
      [
        'Конструктор вопросов',
        '',
        'Соберите вопросы списком и нажмите «Сохранить в бота».',
        'Там же задаются ограничения ответов и название набора для шаблона.',
        'После сохранения вернитесь в чат — вопросы появятся на этом экране.',
      ].join('\n'),
      rows,
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
      `Сейчас участники отвечают ${EFFECTIVE_MODE_LABELS[effective]}.`,
      '',
      'По умолчанию бот решает сам: короткую анкету спрашивает в чате, длинную — '
        + 'в приложении. Можно задать вручную.',
    ].join('\n'),
    rows,
  );
};

