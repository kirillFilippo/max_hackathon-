import type { AppConfig } from '../config.js';
import { isSyntheticUserId, syntheticUserId } from '../domain/ids.js';
import { PRESET_TEMPLATES, fieldsFromPreset } from '../domain/presets.js';
import type {
  DosugEvent,
  EventField,
  ItemWithReservation,
  Participant,
  ParticipantStatus,
} from '../domain/types.js';
import type { EventService } from './eventService.js';
import type { ItemService } from './itemService.js';
import type { ParticipantService } from './participantService.js';

/**
 * Отладочные события: наполняют бота данными за один вызов, чтобы проверять
 * карточки, панель организатора, список покупок и расчёты без второго аккаунта
 * и без ручного ввода десяти заявок.
 *
 * Сервис не работает с репозиториями напрямую: он собирает событие из обычных
 * сервисов (`events`, `participants`, `items`), поэтому лист ожидания, проверка
 * ответов и брони позиций ведут себя ровно так же, как в живом сценарии.
 *
 * Синтетические участники получают отрицательные id (`syntheticUserId`): таких
 * людей в MAX нет, поэтому доставлять им сообщения нельзя — доставка отключена
 * в `createApiNotifier`. Реальный пользователь в отладочном событии один — тот,
 * кто вызвал команду.
 */

/** Тестовые люди: статусы подобраны так, чтобы были видны все состояния состава. */
const DEMO_PEOPLE: Array<{
  name: string;
  username: string | null;
  contact: string;
  status: ParticipantStatus;
}> = [
  { name: 'Аня', username: 'anya_demo', contact: '+7 900 000-00-01', status: 'going' },
  { name: 'Боря', username: 'borya_demo', contact: '+7 900 000-00-02', status: 'going' },
  { name: 'Вика', username: 'vika_demo', contact: '+7 900 000-00-03', status: 'going' },
  { name: 'Гриша', username: null, contact: '@grisha_demo', status: 'going' },
  { name: 'Даша', username: 'dasha_demo', contact: '+7 900 000-00-05', status: 'going' },
  { name: 'Егор', username: 'egor_demo', contact: '@egor_demo', status: 'going' },
  { name: 'Женя', username: 'zhenya_demo', contact: '+7 900 000-00-07', status: 'going' },
  { name: 'Зина', username: null, contact: '', status: 'maybe' },
  { name: 'Игорь', username: 'igor_demo', contact: '+7 900 000-00-09', status: 'not_going' },
];

/** Организатор-пустышка: нужен, когда участником должен быть вызывающий. */
const DEMO_ORGANIZER = { userId: syntheticUserId(1), name: 'Отладка: организатор' };

const DEMO_ITEMS = ['Продукты', 'Вода', 'Настолки', 'Снеки'];
const DEMO_PLACE = 'антикафе Кубик, ул. Ленина 5';
const DEMO_LIMIT = 6;
const DEMO_TEXT_ANSWERS = [
  'Хочу в длинную стратегию',
  'Научу новичков, есть свои наборы',
  'Возьму Каркассон и Диксит',
  'Главное — не Монополия',
];

export interface DebugScenario {
  event: DosugEvent;
  participants: Participant[];
  items: ItemWithReservation[];
  /** Сколько участников синтетические (им сообщения не доставляются). */
  syntheticParticipants: number;
  /** Сколько позиций списка покупок уже забронировано. */
  reservedItems: number;
}

export interface DebugPerson {
  userId: number;
  name: string;
}

export interface DebugServices {
  events: EventService;
  participants: ParticipantService;
  items: ItemService;
}

/** Ответ на вопрос анкеты, который проходит ограничения этого вопроса. */
export const demoAnswer = (field: EventField, index: number): string => {
  switch (field.type) {
    case 'number':
      return String(field.min ?? 1);
    case 'date':
      return '01.01.2027';
    case 'yesno':
      return index % 2 === 0 ? 'Да' : 'Нет';
    case 'choice': {
      if (field.options.length === 0) return '';
      if (!field.multiple) return field.options[index % field.options.length]!;
      const min = Math.max(field.minSelected ?? 1, 1);
      const max = Math.min(field.maxSelected ?? field.options.length, field.options.length);
      return field.options.slice(0, Math.min(min, max)).join(', ');
    }
    case 'text':
    default: {
      const value = DEMO_TEXT_ANSWERS[index % DEMO_TEXT_ANSWERS.length]!;
      return value.slice(0, field.maxLength ?? 500);
    }
  }
};

export class DebugService {
  constructor(
    private readonly services: DebugServices,
    private readonly config: AppConfig,
  ) {}

  /** Событие организатора: полный стол, лист ожидания, покупки и суммы. */
  async createFilledEvent(organizer: DebugPerson): Promise<DebugScenario> {
    const event = await this.createEvent(organizer, {
      title: 'Отладка: настольная игра',
      description: 'Тестовое событие. Можно спокойно ломать: удалить и вызвать команду снова.',
    });
    return this.fill(event);
  }

  /** Событие «чужого» организатора, где вызывающий — обычный участник. */
  async createEventForParticipant(user: DebugPerson): Promise<DebugScenario> {
    const event = await this.createEvent(DEMO_ORGANIZER, {
      title: 'Отладка: меня пригласили',
      description: 'Тестовое событие, чтобы пройти путь участника: заявка, покупки, расчёты.',
    });

    // Одного «идущего» не добавляем: место в основном составе остаётся вызывающему.
    const scenario = await this.fill(event, { skipGoingSlots: 1 });
    await this.register({
      event,
      person: { userId: user.userId, name: user.name },
      index: 0,
      status: 'maybe',
      contact: '',
      username: null,
    });
    return { ...scenario, event };
  }

  private async createEvent(
    organizer: DebugPerson,
    input: { title: string; description: string },
  ): Promise<DosugEvent> {
    const preset = PRESET_TEMPLATES.find((item) => item.key === 'boardgames')
      ?? PRESET_TEMPLATES[0]!;
    // Событие в будущем: напоминания не сработают во время демонстрации.
    const startsAt = new Date(Date.now() + 3 * 24 * 3_600_000);
    startsAt.setHours(19, 0, 0, 0);

    return this.services.events.create({
      title: input.title,
      description: input.description,
      startsAt: startsAt.toISOString(),
      place: DEMO_PLACE,
      placeCoords: null,
      limit: DEMO_LIMIT,
      fields: fieldsFromPreset(preset),
      answerMode: 'auto',
      organizerId: organizer.userId,
      organizerName: organizer.name,
    });
  }

  /** Люди, ответы, список покупок, брони и суммы. */
  private async fill(
    event: DosugEvent,
    options: { skipGoingSlots?: number } = {},
  ): Promise<DebugScenario> {
    const people = [...DEMO_PEOPLE];
    if (options.skipGoingSlots) {
      const index = people.findIndex((person) => person.status === 'going');
      if (index >= 0) people.splice(index, options.skipGoingSlots);
    }

    for (const [index, person] of people.entries()) {
      await this.register({
        event,
        person: { userId: syntheticUserId(index + 10), name: person.name },
        index,
        status: person.status,
        contact: person.contact,
        username: person.username,
      });
    }

    // Первую позицию берёт Аня, вторую — Боря; остальные остаются свободными.
    const items = await this.services.items.add(event.id, DEMO_ITEMS);
    const [products, water] = items;
    if (products) {
      await this.services.items.reserveItem(event, products.id, syntheticUserId(10), 'Аня');
    }
    if (water) {
      await this.services.items.reserveItem(event, water.id, syntheticUserId(11), 'Боря');
    }

    const [participants, freshItems] = await Promise.all([
      this.services.participants.listByEvent(event.id),
      this.services.items.list(event.id),
    ]);

    return {
      event,
      participants,
      items: freshItems,
      syntheticParticipants: participants.filter((item) => isSyntheticUserId(item.userId)).length,
      reservedItems: freshItems.filter((item) => item.reservation !== null).length,
    };
  }

  /** Заявка синтетического человека: ответы проверяются теми же правилами, что и в чате. */
  private async register(input: {
    event: DosugEvent;
    person: DebugPerson;
    index: number;
    status: ParticipantStatus;
    contact: string;
    username: string | null;
  }): Promise<void> {
    const outcome = await this.services.participants.save({
      event: input.event,
      userId: input.person.userId,
      name: input.person.name,
      username: input.username,
      contact: input.contact,
      status: input.status,
      answers: this.answersFor(input.event, input.index),
    });
    if (!outcome.ok) {
      throw new Error(`Отладочные ответы не прошли проверку: ${outcome.error}`);
    }
  }

  private answersFor(event: DosugEvent, index: number): Record<string, string> {
    const answers: Record<string, string> = {};
    event.fields.forEach((field, fieldIndex) => {
      const value = demoAnswer(field, index + fieldIndex);
      if (value !== '') answers[field.id] = value;
    });
    return answers;
  }
}
