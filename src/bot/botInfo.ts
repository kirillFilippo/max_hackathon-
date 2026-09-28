import type { Api } from '@maxhub/max-bot-api';

import type { Logger } from '../logger.js';
import { certificateHint, isCertificateError } from '../tls.js';

/**
 * Знакомство с ботом у платформы MAX.
 *
 * Имя и id нужны для ссылок-приглашений и подсказок команд, но их отсутствие —
 * не повод не запускаться. Домашний интернет и DNS рвутся, и MAX может быть
 * недоступен ровно в момент старта: если здесь упасть, бот останется живым, но
 * без подписки на вебхук — то есть глухим, пока кто-нибудь не перезапустит
 * контейнер. Поэтому ошибку логируем, а данные догоняем позже.
 */
export const fetchBotInfo = async (
  api: Api,
  logger: Logger,
): Promise<Awaited<ReturnType<Api['getMyInfo']>> | null> => {
  try {
    return await api.getMyInfo();
  } catch (error) {
    if (isCertificateError(error)) logger.error(certificateHint());
    logger.error(
      'MAX не ответил на запрос данных бота — продолжаю запуск без них, '
        + 'подписка и подсказки команд догонятся при восстановлении связи',
      error,
    );
    return null;
  }
};

/** Подсказки команд: необязательная часть, ошибку только логируем. */
export const publishCommands = async (
  api: Api,
  commands: Array<{ name: string; description: string }>,
  logger: Logger,
): Promise<void> => {
  try {
    await api.setMyCommands(commands);
  } catch (error) {
    logger.warn('Не удалось опубликовать подсказки команд, это не критично', error);
  }
};
