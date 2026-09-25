import type { AppConfig } from '../config.js';
import type { Repositories } from '../db/repositories/index.js';
import { computeEventStats } from '../domain/stats.js';
import type { DosugEvent, EventStats, Participant } from '../domain/types.js';

export interface ReminderTask {
  kind: 'confirm' | 'final';
  event: DosugEvent;
  participant: Participant;
  stats: EventStats;
}

export interface ReminderTick {
  tasks: ReminderTask[];
  closedEvents: DosugEvent[];
}

/**
 * Планировщик напоминаний.
 *
 * Окна:
 *  - «подтвердите статус» — [начало − confirmHours, начало − finalHours);
 *  - «детали встречи»     — [начало − finalHours, начало).
 *
 * Отметка об отправке хранится у участника, поэтому повторный тик не дублирует
 * сообщение, а неудачная отправка повторится на следующем проходе.
 * Сервис только выбирает задачи и фиксирует факт отправки — тексты и доставку
 * делает слой бота.
 */
export class ReminderService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: AppConfig,
  ) {}

  async due(now: Date = new Date()): Promise<ReminderTick> {
    const closedEvents = await this.repos.events.closeStartedBefore(
      new Date(now.getTime() - this.config.eventStaleHours * 3_600_000),
    );

    const events = await this.repos.events.listPublished();
    const confirmWindowMs = this.config.reminderConfirmHours * 3_600_000;
    const finalWindowMs = this.config.reminderFinalHours * 3_600_000;
    const tasks: ReminderTask[] = [];

    for (const event of events) {
      const startMs = new Date(event.startsAt).getTime();
      const createdAtMs = new Date(event.createdAt).getTime();
      const nowMs = now.getTime();
      if (nowMs >= startMs) continue;

      const confirmAtMs = startMs - confirmWindowMs;
      const finalAtMs = startMs - finalWindowMs;
      const inConfirmWindow = nowMs >= confirmAtMs && nowMs < finalAtMs;
      const inFinalWindow = nowMs >= finalAtMs;

      const participants = await this.repos.participants.listByEvent(event.id);
      const stats = computeEventStats(event, participants);

      for (const participant of participants) {
        if (participant.status === 'not_going') continue;

        if (
          inConfirmWindow
          && createdAtMs <= confirmAtMs
          && participant.confirmSentAt === null
        ) {
          tasks.push({ kind: 'confirm', event, participant, stats });
          continue;
        }

        if (inFinalWindow && participant.finalSentAt === null) {
          tasks.push({ kind: 'final', event, participant, stats });
        }
      }
    }

    return { tasks, closedEvents };
  }

  /** Фиксирует факт доставки напоминания участнику. */
  async markSent(task: ReminderTask, now: Date = new Date()): Promise<void> {
    await this.repos.participants.patch(task.event.id, task.participant.userId, {
      confirmSentAt: task.kind === 'confirm' ? now.toISOString() : task.participant.confirmSentAt,
      finalSentAt: task.kind === 'final' ? now.toISOString() : task.participant.finalSentAt,
    });
  }
}
