import type { Context } from '@maxhub/max-bot-api';

import type { DosugEvent } from '../../domain/types.js';
import { replyTo, type BotContext } from '../context.js';
import type { AppDeps } from '../deps.js';
import { menuRow, withKeyboard, type MessageContent } from '../message.js';

export { menuRow };

export type SdkUser = NonNullable<Context['user']>;

export const requireUser = (ctx: BotContext): SdkUser => {
  const user = ctx.user;
  if (!user) throw new Error(`Обновление ${ctx.updateType} не содержит пользователя`);
  return user;
};

export const userIdOf = (ctx: BotContext): number => requireUser(ctx).user_id;

export const botUsernameOf = (ctx: BotContext, deps: AppDeps): string | undefined =>
  ctx.botInfo?.username ?? deps.config.botUsername;

/** Обёртка обработчика: ошибка логируется, пользователь получает понятный ответ. */
export const withErrorHandling = (
  deps: AppDeps,
  scope: string,
  handler: (ctx: BotContext) => Promise<unknown>,
): ((ctx: BotContext) => Promise<void>) => {
  return async (ctx: BotContext) => {
    try {
      await handler(ctx);
    } catch (error) {
      deps.logger.error(`Ошибка в обработчике ${scope}`, error);
      try {
        await replyTo(
          ctx,
          withKeyboard('Не получилось выполнить действие. Попробуйте ещё раз.', menuRow),
        );
      } catch (secondary) {
        deps.logger.error('Не удалось отправить сообщение об ошибке', secondary);
      }
    }
  };
};

/** Рассылка участникам события. Возвращает число доставленных сообщений. */
export const notifyParticipants = async (
  deps: AppDeps,
  event: DosugEvent,
  content: MessageContent,
  options: { includeNotGoing?: boolean; onlyUserId?: number } = {},
): Promise<number> => {
  const participants = await deps.repos.participants.listByEvent(event.id);
  let sent = 0;
  for (const participant of participants) {
    if (!options.includeNotGoing && participant.status === 'not_going') continue;
    if (options.onlyUserId !== undefined && participant.userId !== options.onlyUserId) continue;
    try {
      await deps.notifier.sendToUser(participant.userId, content);
      sent += 1;
    } catch (error) {
      deps.logger.warn(`Не удалось отправить сообщение участнику ${participant.userId}`, error);
    }
  }
  return sent;
};

export const sendToUser = async (
  deps: AppDeps,
  userId: number,
  content: MessageContent,
): Promise<boolean> => {
  try {
    await deps.notifier.sendToUser(userId, content);
    return true;
  } catch (error) {
    deps.logger.warn(`Не удалось отправить сообщение пользователю ${userId}`, error);
    return false;
  }
};
