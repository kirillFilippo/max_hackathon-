import type { MessageContent } from '../src/bot/message.js';
import type { Notifier } from '../src/bot/notifier.js';

export interface SentMessage {
  userId: number;
  text: string;
  content: MessageContent;
}

export interface SentChatMessage {
  chatId: number;
  text: string;
  content: MessageContent;
}

export interface FakeNotifier extends Notifier {
  messages: SentMessage[];
  chatMessages: SentChatMessage[];
  failFor: Set<number>;
  messagesFor(userId: number): SentMessage[];
  messagesForChat(chatId: number): SentChatMessage[];
}

/** Заглушка доставки: записывает сообщения вместо вызовов MAX API. */
export const makeFakeNotifier = (): FakeNotifier => {
  const messages: SentMessage[] = [];
  const chatMessages: SentChatMessage[] = [];
  const failFor = new Set<number>();

  return {
    messages,
    chatMessages,
    failFor,
    async sendToUser(userId: number, content: MessageContent) {
      if (failFor.has(userId)) throw new Error(`доставка для ${userId} недоступна`);
      messages.push({ userId, text: content.text, content });
    },
    async sendToChat(chatId: number, content: MessageContent) {
      if (failFor.has(chatId)) throw new Error(`доставка в чат ${chatId} недоступна`);
      chatMessages.push({ chatId, text: content.text, content });
    },
    messagesFor(userId: number) {
      return messages.filter((message) => message.userId === userId);
    },
    messagesForChat(chatId: number) {
      return chatMessages.filter((message) => message.chatId === chatId);
    },
  };
};
