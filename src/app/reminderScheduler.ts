import type { AppDeps } from '../bot/deps.js';
import { runReminderTick, type ReminderRunResult } from '../bot/reminderRunner.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';

export interface ReminderScheduler {
  /** Один прогон: нужен тестам и запуску. */
  tick(now?: Date): Promise<ReminderRunResult>;
  start(): void;
  stop(): void;
}

/**
 * Планировщик напоминаний: раз в `REMINDER_TICK_SECONDS` прогоняет тик.
 *
 * Защита от наложения живёт здесь же: пока предыдущий тик не завершился,
 * следующий не запускается — иначе медленная рассылка копилась бы сама на себя.
 */
export const createReminderScheduler = (
  deps: AppDeps,
  config: AppConfig,
  logger: Logger,
): ReminderScheduler => {
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  const tick = async (now: Date = new Date()): Promise<ReminderRunResult> => {
    const empty: ReminderRunResult = { confirmSent: 0, finalSent: 0, closed: 0, errors: 0 };
    if (ticking) return empty;
    ticking = true;
    try {
      const result = await runReminderTick(deps, now);
      if (result.confirmSent || result.finalSent || result.closed || result.errors) {
        logger.info(
          `Напоминания: подтверждение — ${result.confirmSent}, детали — ${result.finalSent}, `
            + `закрыто событий — ${result.closed}, ошибок — ${result.errors}`,
        );
      }
      return result;
    } catch (error) {
      logger.error('Ошибка планировщика напоминаний', error);
      return { ...empty, errors: 1 };
    } finally {
      ticking = false;
    }
  };

  return {
    tick,
    start: () => {
      timer = setInterval(() => void tick(), config.reminderTickSeconds * 1000);
      logger.info(`Напоминания проверяются каждые ${config.reminderTickSeconds} с`);
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
};
