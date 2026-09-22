import type { Api, Context } from '@maxhub/max-bot-api';

import { inlineKeyboard, type MessageContent } from './message.js';
import type { BotSession } from './session.js';

export type BotContext = Context & { session: BotSession };

export type SendExtra = NonNullable<Parameters<Api['sendMessageToUser']>[2]>;
export type EditExtra = NonNullable<Parameters<Api['editMessage']>[1]>;

/**
 * Преобразует подготовленное сообщение в параметры MAX API. Формат разметки не
 * задаём: тексты собираются как обычный текст, чтобы пользовательские данные
 * вроде «<Оля>» не ломали разметку.
 */
export const contentToExtra = (content: MessageContent, extra: SendExtra = {}): SendExtra => {
  const attachments = content.keyboard
    ? [...(extra.attachments ?? []), inlineKeyboard(content.keyboard)]
    : extra.attachments;
  const payload: SendExtra = { ...extra };
  if (content.format) payload.format = content.format;
  if (attachments) payload.attachments = attachments;
  return payload;
};

/**
 * Редактирование сообщения может не пройти (сообщение удалено, устарело).
 * Тогда мы отправляем новое — но об этом стоит знать в логах: именно такие
 * случаи выглядят как «бот прислал два сообщения».
 */
let editFailureReporter: ((error: unknown) => void) | null = null;

export const setEditFailureReporter = (reporter: (error: unknown) => void): void => {
  editFailureReporter = reporter;
};

/**
 * Текст, который ввёл пользователь. Для нажатий кнопок возвращает пустую строку:
 * в обновлении с кнопкой тоже есть message, но там текст экрана, а не ответ.
 */
export const userText = (ctx: BotContext): string =>
  ctx.updateType === 'message_created' ? (ctx.message?.body.text?.trim() ?? '') : '';

export const targetOf = (ctx: BotContext): { chatId?: number; userId?: number } => ({
  chatId: ctx.chatId ?? undefined,
  userId: ctx.user?.user_id ?? undefined,
});

export const sendTo = async (
  ctx: BotContext,
  content: MessageContent,
  extra: SendExtra = {},
): Promise<void> => {
  const { chatId, userId } = targetOf(ctx);
  const payload = contentToExtra(content, extra);
  if (chatId !== undefined) {
    await ctx.api.sendMessageToChat(chatId, content.text, payload);
    return;
  }
  if (userId !== undefined) {
    await ctx.api.sendMessageToUser(userId, content.text, payload);
    return;
  }
  throw new Error('Не удалось определить получателя сообщения в обновлении');
};

export const answerCallback = async (ctx: BotContext): Promise<void> => {
  if (ctx.updateType !== 'message_callback') return;
  try {
    await ctx.answerOnCallback({});
  } catch {
    // Ответ на callback необязателен: если он не прошёл, продолжаем сценарий.
  }
};

/** Отправляет новое сообщение. */
export const replyTo = async (
  ctx: BotContext,
  content: MessageContent,
  extra: SendExtra = {},
): Promise<void> => {
  await sendTo(ctx, content, extra);
  await answerCallback(ctx);
};

/**
 * Обновляет сообщение с кнопкой, если действие пришло из callback, иначе
 * отправляет новое. Так экраны не засоряют чат.
 */
export const show = async (
  ctx: BotContext,
  content: MessageContent,
  extra: EditExtra = {},
): Promise<void> => {
  if (ctx.updateType === 'message_callback' && ctx.messageId) {
    try {
      const payload = contentToExtra(content, extra as SendExtra);
      await ctx.editMessage({
        text: content.text,
        ...payload,
        // Новый экран без клавиатуры не должен оставлять старые кнопки.
        ...(content.keyboard ? {} : { attachments: payload.attachments ?? [] }),
      });
      await answerCallback(ctx);
      return;
    } catch (error) {
      // Сообщение могло быть удалено или слишком старое — отправляем новое,
      // но фиксируем причину: из-за этого в чате появляется лишнее сообщение.
      editFailureReporter?.(error);
    }
  }
  await replyTo(ctx, content, extra as SendExtra);
};
