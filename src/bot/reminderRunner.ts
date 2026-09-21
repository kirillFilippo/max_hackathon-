import type { AppDeps } from './deps.js';
import type { ReminderTask } from '../services/reminderService.js';
import { confirmReminder, finalReminder } from './texts/registration.js';

export interface ReminderRunResult {
  confirmSent: number;
  finalSent: number;
  closed: number;
  errors: number;
}

/**
 * Прогон планировщика: сервис выбирает, кому и что напомнить, а этот модуль
 * рендерит текст, отправляет сообщение и фиксирует факт доставки.
 */
export const runReminderTick = async (
  deps: AppDeps,
  now: Date = new Date(),
): Promise<ReminderRunResult> => {
  const result: ReminderRunResult = { confirmSent: 0, finalSent: 0, closed: 0, errors: 0 };
  const tick = await deps.reminders.due(now);
  result.closed = tick.closedEvents.length;
  tick.closedEvents.forEach((event) =>
    deps.logger.info(`Событие ${event.code} автоматически завершено`),
  );

  for (const task of tick.tasks) {
    const content = await renderReminder(deps, task);
    try {
      await deps.notifier.sendToUser(task.participant.userId, content);
      await deps.reminders.markSent(task, now);
      if (task.kind === 'confirm') result.confirmSent += 1;
      else result.finalSent += 1;
    } catch (error) {
      result.errors += 1;
      deps.logger.warn(
        `Не удалось отправить напоминание (${task.kind}) участнику ${task.participant.userId}`,
        error,
      );
    }
  }

  return result;
};

const renderReminder = async (deps: AppDeps, task: ReminderTask) => {
  const { event } = task;
  if (task.kind === 'confirm') {
    return confirmReminder(event, { tz: deps.config.appTz });
  }
  const items = await deps.items.list(event.id);
  return finalReminder(event, task.stats, items, { tz: deps.config.appTz });
};
