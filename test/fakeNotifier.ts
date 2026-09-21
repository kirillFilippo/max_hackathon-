import type { MessageContent } from '../src/bot/message.js';
import type { Notifier } from '../src/bot/notifier.js';

export interface SentMessage {
  userId: number;
  text: string;
  content: MessageContent;
}

export interface FakeNotifier extends Notifier {
  messages: SentMessage[];
  failFor: Set<number>;
  messagesFor(userId: number): SentMessage[];
}

/** Заглушка доставки: записывает сообщения вместо вызовов MAX API. */
export const makeFakeNotifier = (): FakeNotifier => {
  const messages: SentMessage[] = [];
  const failFor = new Set<number>();

  return {
    messages,
    failFor,
    async sendToUser(userId: number, content: MessageContent) {
      if (failFor.has(userId)) throw new Error(`доставка для ${userId} недоступна`);
      messages.push({ userId, text: content.text, content });
    },
    messagesFor(userId: number) {
      return messages.filter((message) => message.userId === userId);
    },
  };
};
