import type { DosugEvent, EventStats, Participant } from './types.js';

/**
 * Статистика по составу участников. Одна реализация на весь проект: её
 * используют и панель организатора, и планировщик напоминаний.
 */
/**
 * Идёт ли человек на событие: «иду» и не в листе ожидания. Условие встречается
 * в панели, напоминаниях и FAQ — держим его в одном месте, иначе списки «идут»
 * начнут расходиться между экранами.
 */
export const isGoing = (participant: Participant): boolean =>
  participant.status === 'going' && !participant.waitlisted;

/** Участники основного состава (без листа ожидания). */
export const goingParticipants = (participants: Participant[]): Participant[] =>
  participants.filter(isGoing);

export const computeEventStats = (event: DosugEvent, participants: Participant[]): EventStats => {
  const going = goingParticipants(participants).length;
  const maybe = participants.filter((p) => p.status === 'maybe').length;
  const notGoing = participants.filter((p) => p.status === 'not_going').length;
  const pending = participants.filter((p) => p.status === 'pending').length;
  const waitlisted = participants.filter((p) => p.waitlisted).length;
  const free = event.limit === null ? null : Math.max(event.limit - going, 0);
  const totalWithStatus = going + maybe + notGoing + pending;

  return {
    going,
    maybe,
    notGoing,
    pending,
    waitlisted,
    limit: event.limit,
    free,
    confirmedShare: totalWithStatus === 0 ? 0 : going / totalWithStatus,
  };
};
