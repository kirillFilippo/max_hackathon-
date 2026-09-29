import type { MiniappTicket } from '../miniapp/contracts.js';
import type { SessionsStore } from '../db/storage.js';

/**
 * Подписи конструктора вопросов мини-приложения.
 *
 * Подпись — это короткий пропуск: по нему страница забирает черновик организатора
 * и сохраняет готовые вопросы. Хранится в том же хранилище сессий, что и черновики
 * мастеров, поэтому переживает перезапуск бота и деплой. Раньше пропуски лежали в
 * `Map` внутри процесса: после рестарта кнопка «Открыть конструктор» в уже
 * отправленном сообщении переставала работать, а при нескольких репликах пропуск,
 * выданный одной, не находила другая.
 *
 * Срок жизни проверяем сами: в хранилище сессий запись живёт по общему TTL, а
 * пропуску хватит и пятнадцати минут.
 */
export const TICKET_TTL_MS = 15 * 60 * 1000;

/**
 * Пропуск описывается контрактом мини-приложения (`MiniappTicket`): странице нужны
 * и сессия мастера, и чат. Пропуск без любого из этих полей недействителен —
 * «угадывать» черновик по пользователю нельзя, у него может быть несколько чатов.
 */
export type TicketOwner = MiniappTicket;

export interface MiniappTicketStore {
  register: (ticket: string, owner: TicketOwner) => Promise<void>;
  take: (ticket: string) => Promise<TicketOwner | null>;
}

export const ticketKey = (ticket: string): string => `ticket:${ticket}`;

export const createMiniappTicketStore = (
  sessions: SessionsStore<object>,
  ttlMs: number = TICKET_TTL_MS,
): MiniappTicketStore => ({
  register: async (ticket, owner) => {
    await sessions.set(ticketKey(ticket), { ...owner });
  },

  // Подпись не гасим: при ошибке проверки организатор может исправить данные
  // и нажать «Сохранить» ещё раз, пока срок не истёк.
  take: async (ticket) => {
    const stored = (await sessions.get(ticketKey(ticket))) as Partial<TicketOwner> | undefined;
    if (!stored) return null;
    // Пропуск без чата или сессии мастера недействителен: такие записи могли
    // остаться от версии, где черновик искали «первый подходящий у пользователя».
    if (
      typeof stored.userId !== 'number'
      || typeof stored.chatId !== 'number'
      || typeof stored.sessionKey !== 'string'
      || typeof stored.at !== 'number'
    ) {
      await sessions.delete(ticketKey(ticket));
      return null;
    }
    if (Date.now() - stored.at > ttlMs) {
      await sessions.delete(ticketKey(ticket));
      return null;
    }
    return stored as TicketOwner;
  },
});
