import type { MiniappTicket } from '../src/miniapp/contracts.js';

/**
 * Пропуск конструктора для тестов.
 *
 * Один способ собрать пропуск на все тесты: до этого их было три (`ticketFor`
 * в `miniappSync`, `owner` в `miniappTickets`, инлайн в `miniapp`) и они
 * расходились в том, что считают значением по умолчанию для чата и сессии.
 */

/** Пропуск пользователя: по умолчанию он же чат и сессия (`userId:chatId`). */
export const ticketFor = (
  userId: number,
  overrides: Partial<MiniappTicket> = {},
): MiniappTicket => ({
  userId,
  chatId: userId,
  sessionKey: `${userId}:${userId}`,
  at: Date.now(),
  ...overrides,
});

/** Пропуск для сессии вида «userId:chatId» — так ключ строит middleware MAX. */
export const ticketOfSession = (sessionKey: string): MiniappTicket => {
  const [userId = 0, chatId = 0] = sessionKey.split(':').map(Number);
  return { userId, chatId, sessionKey, at: Date.now() };
};
