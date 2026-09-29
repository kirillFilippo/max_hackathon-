import type { Api } from '@maxhub/max-bot-api';

import { isSyntheticUserId } from '../domain/ids.js';
import type { MessageContent } from './message.js';
import { contentToExtra } from './context.js';

/** Доставка сообщений: напоминания, уведомления организатору, рассылки, экраны мастеров. */
export interface Notifier {
  sendToUser(userId: number, content: MessageContent): Promise<void>;
  /**
   * Сообщение в чат. Нужно там, где известен чат, а не пользователь: например,
   * конструктор вопросов открывают из конкретного чата, и обновлённый экран
   * должен вернуться именно туда (в MAX личный диалог — тоже чат).
   */
  sendToChat(chatId: number, content: MessageContent): Promise<void>;
}

export const createApiNotifier = (api: Api): Notifier => ({
  sendToUser: async (userId: number, content: MessageContent) => {
    // Синтетические участники отладочных событий в MAX не существуют: отправка
    // вернула бы ошибку, поэтому таким пользователям сообщения не уходят.
    if (isSyntheticUserId(userId)) return;
    await api.sendMessageToUser(userId, content.text, contentToExtra(content));
  },
  sendToChat: async (chatId: number, content: MessageContent) => {
    await api.sendMessageToChat(chatId, content.text, contentToExtra(content));
  },
});
