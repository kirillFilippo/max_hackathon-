import type { Api } from '@maxhub/max-bot-api';

import { isSyntheticUserId } from '../domain/ids.js';
import type { MessageContent } from './message.js';
import { contentToExtra } from './context.js';

/** Доставка личных сообщений: напоминания, уведомления о расчётах, рассылки. */
export interface Notifier {
  sendToUser(userId: number, content: MessageContent): Promise<void>;
}

export const createApiNotifier = (api: Api): Notifier => ({
  sendToUser: async (userId: number, content: MessageContent) => {
    // Синтетические участники отладочных событий в MAX не существуют: отправка
    // вернула бы ошибку, поэтому таким пользователям сообщения не уходят.
    if (isSyntheticUserId(userId)) return;
    await api.sendMessageToUser(userId, content.text, contentToExtra(content));
  },
});
