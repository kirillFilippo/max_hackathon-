import { answerFaq, FAQ_ITEMS, matchFaq, type FaqContext } from '../../../services/faqService.js';
import { CB, cbFaqQuestion } from '../../callbacks.js';
import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import { cb, chunk, withKeyboard } from '../../message.js';
import { userIdOf } from '../helpers.js';

const buildContext = async (
  ctx: BotContext,
  deps: AppDeps,
  eventCode?: string | null,
): Promise<FaqContext> => {
  const code = eventCode ?? ctx.session?.lastEventCode ?? null;
  if (!code) return { tz: deps.config.appTz };

  const event = await deps.events.findByCode(code);
  if (!event) return { tz: deps.config.appTz };

  const [participants, items] = await Promise.all([
    deps.participants.listByEvent(event.id),
    deps.items.list(event.id),
  ]);
  return {
    event,
    participants,
    items,
    participant: participants.find((participant) => participant.userId === userIdOf(ctx)),
    stats: deps.events.stats(event, participants),
    tz: deps.config.appTz,
  };
};

export const showFaq = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const code = ctx.session?.lastEventCode ?? null;
  const event = code ? await deps.events.findByCode(code) : null;

  const rows = chunk(FAQ_ITEMS, 2).map((pair) =>
    pair.map((item) =>
      cb(
        item.question,
        event ? cbFaqEventPayload(event.code, item.key) : cbFaqQuestion(item.key),
      ),
    ),
  );
  rows.push([cb('В меню', CB.menuMain)]);

  const lines = [
    'Частые вопросы',
    '',
    'Выберите вопрос или напишите свой: бот поищет ответ по ключевым словам.',
  ];
  if (event) lines.push('', `Отвечаю в контексте события «${event.title}» (${event.code}).`);
  await show(ctx, withKeyboard(lines.join('\n'), rows));
};

const cbFaqEventPayload = (code: string, key: string): string => `faq:ev:${code}:${key}`;

export const answerFaqKey = async (
  ctx: BotContext,
  deps: AppDeps,
  key: string,
  eventCode?: string,
): Promise<void> => {
  const item = FAQ_ITEMS.find((faq) => faq.key === key);
  if (!item) {
    await showFaq(ctx, deps);
    return;
  }
  const context = await buildContext(ctx, deps, eventCode);
  await show(
    ctx,
    withKeyboard(`Вопрос: ${item.question}\n\n${answerFaq(item, context)}`, [
      [cb('Другие вопросы', CB.menuFaq), cb('В меню', CB.menuMain)],
    ]),
  );
};

/**
 * Пытается ответить на свободный текст по ключевым словам FAQ.
 * Возвращает true, если ответ найден и отправлен.
 */
export const tryAnswerFaqText = async (
  ctx: BotContext,
  deps: AppDeps,
  input: string,
): Promise<boolean> => {
  const item = matchFaq(input);
  if (!item) return false;
  const context = await buildContext(ctx, deps);
  await show(
    ctx,
    withKeyboard(`Вопрос: ${item.question}\n\n${answerFaq(item, context)}`, [
      [cb('Другие вопросы', CB.menuFaq), cb('В меню', CB.menuMain)],
    ]),
  );
  return true;
};
