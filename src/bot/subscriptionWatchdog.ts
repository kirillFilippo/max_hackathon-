import type { Logger } from '../logger.js';

/**
 * Сторож подписки на вебхук.
 *
 * Зачем: MAX доставляет обновления на публичный адрес только пока у бота есть
 * активная подписка. Если домашний интернет или туннель отвалились, платформа
 * подписку теряет — и дальше процесс жив, `/health` отвечает, а сообщения
 * в бота не приходят. Сам бот подписывался только при старте, поэтому лечение
 * было ручным («перезапусти контейнер»).
 *
 * Теперь раз в `WEBHOOK_CHECK_SECONDS` спрашиваем у MAX список подписок и, если
 * нашей там нет, оформляем её заново. Ошибки сети не считаются фатальными:
 * следующий тик попробует снова.
 */
export interface SubscriptionLike {
  url: string;
}

/** Минимум методов MAX API, который нужен сторожу (удобно подменять в тестах). */
export interface SubscriptionApi {
  getSubscriptions(): Promise<SubscriptionLike[]>;
  subscribe(url: string, secret?: string, updateTypes?: string[]): Promise<unknown>;
}

export interface EnsureSubscriptionOptions {
  api: SubscriptionApi;
  logger: Logger;
  /** Публичный адрес нашего вебхука. */
  url: string;
  secret?: string;
}

export type SubscriptionState =
  /** Подписка на месте. */
  | 'ok'
  /** Подписки не было — оформили. */
  | 'restored'
  /** Проверить или восстановить не удалось (сеть): попробуем на следующем тике. */
  | 'failed';

export const ensureSubscription = async (
  options: EnsureSubscriptionOptions,
): Promise<SubscriptionState> => {
  const { api, logger, url, secret } = options;

  let subscriptions: SubscriptionLike[];
  try {
    subscriptions = await api.getSubscriptions();
  } catch (error) {
    logger.warn('Не удалось получить список подписок MAX (проверим на следующем тике)', error);
    return 'failed';
  }

  if (subscriptions.some((subscription) => subscription.url === url)) return 'ok';

  try {
    await api.subscribe(url, secret);
    logger.warn(`Подписка на ${url} пропала — оформил заново`);
    return 'restored';
  } catch (error) {
    logger.error(`Не удалось восстановить подписку на ${url}`, error);
    return 'failed';
  }
};

export interface WatchdogOptions extends EnsureSubscriptionOptions {
  /** Период проверки в миллисекундах. */
  intervalMs: number;
}

export interface WatchdogHandle {
  /** Одна проверка — нужна тестам и запуску. */
  check(): Promise<SubscriptionState>;
  stop(): void;
}

/** Запускает периодическую проверку подписки. */
export const startSubscriptionWatchdog = (options: WatchdogOptions): WatchdogHandle => {
  let checking = false;
  const check = async (): Promise<SubscriptionState> => {
    if (checking) return 'ok';
    checking = true;
    try {
      return await ensureSubscription(options);
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void check(), options.intervalMs);
  // Таймер не должен удерживать процесс при остановке.
  timer.unref?.();

  return {
    check,
    stop: () => clearInterval(timer),
  };
};
