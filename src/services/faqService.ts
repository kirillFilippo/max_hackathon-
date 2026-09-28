import { formatDateTime, formatRelative } from '../domain/datetime.js';
import { FAQ_ITEMS, type FaqItem } from '../domain/faq.js';
import { goingParticipants, isGoing } from '../domain/stats.js';
import { normalizeUserText } from '../domain/text.js';
import type {
  DosugEvent,
  EventStats,
  ItemWithReservation,
  Participant,
} from '../domain/types.js';

export { FAQ_ITEMS };
export type { FaqItem };

export interface FaqContext {
  event?: DosugEvent;
  participant?: Participant;
  participants?: Participant[];
  items?: ItemWithReservation[];
  stats?: EventStats;
  tz: string;
  now?: Date;
}

/** Ищет подходящий вопрос по ключевым словам; выбирает самое длинное совпадение. */
export const matchFaq = (input: string): FaqItem | null => {
  const text = normalizeUserText(input);
  if (!text) return null;

  let best: { item: FaqItem; weight: number } | null = null;
  for (const item of FAQ_ITEMS) {
    for (const keyword of item.keywords) {
      const normalizedKeyword = normalizeUserText(keyword);
      if (text.includes(normalizedKeyword)) {
        const weight = normalizedKeyword.length;
        if (!best || weight > best.weight) best = { item, weight };
      }
    }
  }
  return best?.item ?? null;
};

export const answerFaq = (item: FaqItem, context: FaqContext): string => {
  const { event, participants = [], items = [], stats } = context;
  const now = context.now ?? new Date();
  if (!event) return item.answer;

  switch (item.key) {
    case 'where':
      return `Место: ${event.place}`;
    case 'when': {
      const startsAt = new Date(event.startsAt);
      return `Когда: ${formatDateTime(startsAt, context.tz)} (${formatRelative(now, startsAt, context.tz)})`;
    }
    case 'bring': {
      if (items.length === 0) {
        return 'Организатор ещё не заполнил список покупок. Если нужно что-то взять с собой, уточните у него.';
      }
      const free = items.filter((entry) => entry.reservation === null);
      const taken = items.filter((entry) => entry.reservation !== null);
      const lines: string[] = [];
      if (free.length > 0) lines.push(`Свободно: ${free.map((entry) => entry.title).join(', ')}`);
      if (taken.length > 0) {
        lines.push(
          `Уже разобрали: ${taken
            .map((entry) => `${entry.title} — ${entry.reservation?.userName ?? ''}`)
            .join('; ')}`,
        );
      }
      lines.push('Забронировать позицию можно в разделе «Список покупок» карточки события.');
      return lines.join('\n');
    }
    case 'who': {
      const going = participants.filter(
        isGoing,
      );
      if (going.length === 0) return 'Пока никто не подтвердил участие.';
      const names = going.slice(0, 12).map((participant) => participant.name).join(', ');
      const rest = going.length > 12 ? ` и ещё ${going.length - 12}` : '';
      return `Идут (${going.length}): ${names}${rest}`;
    }
    case 'limit': {
      if (event.limit === null) return 'Лимита нет, можно присоединяться.';
      const going = stats?.going
        ?? goingParticipants(participants).length;
      const free = Math.max(event.limit - going, 0);
      return free > 0
        ? `Лимит ${event.limit}, свободно ${free} мест.`
        : `Лимит ${event.limit} исчерпан. Бот запишет вас в лист ожидания и сообщит, если место освободится.`;
    }
    case 'money': {
      return 'Бот помогает собрать людей и не дублировать покупки: позиции списка бронируются, '
        + 'каждый видит, что берёт он, а что уже взяли другие. '
        + 'Разделение трат и переводы между участниками — в планах: сейчас бот деньги не считает.';
    }
    default:
      return item.answer;
  }
};
