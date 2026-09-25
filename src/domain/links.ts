/**
 * Ссылки на бота и мини-приложение MAX.
 *
 * Живут в домене, а не в слое бота: эти адреса — часть контракта с платформой
 * (payload диплинка, префиксы `ev_`/`tpl_`), и сервисы строят их так же, как
 * обработчики. Раньше сервис событий импортировал функцию из слоя бота — это
 * было единственное нарушение направления зависимостей.
 */

/** Префикс payload'а диплинка с кодом события. */
export const EVENT_START_PREFIX = 'ev_';
/** Префикс payload'а конструктора вопросов в мини-приложении. */
export const CONSTRUCTOR_START_PREFIX = 'tpl_';

/** Публичная ссылка на бота с payload диплинка. */
export const buildInviteUrl = (botUsername: string, eventCode: string): string =>
  `https://max.ru/${botUsername}?start=${EVENT_START_PREFIX}${eventCode}`;

/** Диплинк мини-приложения с анкетой: MAX отдаёт это в start_param. */
export const buildAnswersUrl = (botUsername: string, eventCode: string): string =>
  `https://max.ru/${botUsername}?startapp=${EVENT_START_PREFIX}${eventCode}`;

/**
 * Диплинк мини-приложения с конструктором вопросов. Открываем конструктор тем же
 * способом, что и анкету участника: MAX сам открывает зарегистрированное
 * мини-приложение, а подпись мастера едет в `start_param`.
 */
export const buildConstructorUrl = (botUsername: string, ticket: string): string =>
  `https://max.ru/${botUsername}?startapp=${CONSTRUCTOR_START_PREFIX}${ticket}`;

/** Достаёт код события из payload диплинка `/start`. */
export const eventCodeFromStartPayload = (payload: string | null | undefined): string | null => {
  if (!payload) return null;
  const trimmed = payload.trim();
  if (trimmed.startsWith(EVENT_START_PREFIX)) {
    return trimmed.slice(EVENT_START_PREFIX.length).toUpperCase();
  }
  return null;
};

/**
 * Разбирает текст команды `/start` (в том числе `/start@Бот payload`).
 * Возвращает payload или null, если это не команда запуска: одна реализация
 * используется и роутером сообщений, и дедупликатором входов.
 */
export const startCommandPayload = (text: string): string | null => {
  const match = /^\/start(?:@[\w_]+)?(?:\s+(\S+))?$/i.exec(text.trim());
  return match ? (match[1] ?? '') : null;
};
