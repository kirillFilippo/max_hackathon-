import type { Repositories } from '../db/repositories/index.js';
import type { DosugEvent, ItemWithReservation } from '../domain/types.js';

export interface ReserveOutcome {
  /** Позиции, которые удалось забронировать сейчас. */
  reserved: ItemWithReservation[];
  /** Позиции, уже занятые другими: показываем, кому они достались. */
  taken: Array<{ item: ItemWithReservation; byName: string }>;
  /** Позиции, которые уже были за этим же пользователем. */
  alreadyMine: ItemWithReservation[];
  /** Номера, которых нет в списке. */
  unknown: number[];
  /** Что осталось свободным после операции. */
  free: ItemWithReservation[];
}

/**
 * Список покупок. Инвариант: одну позицию резервирует ровно один человек
 * (за это отвечает первичный ключ reservations.item_id), поэтому «кто первый,
 * того и позиция», а остальным бот показывает, что осталось.
 */
export class ItemService {
  constructor(private readonly repos: Repositories) {}

  /** Добавляет позиции: каждая строка ввода — отдельный предмет. */
  async add(eventId: string, titles: string[]): Promise<ItemWithReservation[]> {
    return this.repos.items.addMany(eventId, titles);
  }

  list(eventId: string): Promise<ItemWithReservation[]> {
    return this.repos.items.listByEvent(eventId);
  }

  mine(eventId: string, userId: number): Promise<ItemWithReservation[]> {
    return this.repos.items.listReservedByUser(eventId, userId);
  }

  find(itemId: string): Promise<ItemWithReservation | null> {
    return this.repos.items.findById(itemId);
  }

  /**
   * Бронирует позиции по их номерам в списке (нумерация с единицы, как видит
   * пользователь). Конфликты не считаются ошибкой: занятые позиции попадают
   * в `taken` вместе с именем того, кто их взял.
   */
  async reserveByNumbers(
    event: DosugEvent,
    userId: number,
    userName: string,
    numbers: number[],
  ): Promise<ReserveOutcome> {
    const items = await this.repos.items.listByEvent(event.id);
    const byNumber = new Map<number, ItemWithReservation>();
    items.forEach((item, index) => byNumber.set(index + 1, item));

    const outcome: ReserveOutcome = {
      reserved: [],
      taken: [],
      alreadyMine: [],
      unknown: [],
      free: [],
    };

    for (const number of numbers) {
      const item = byNumber.get(number);
      if (!item) {
        outcome.unknown.push(number);
        continue;
      }
      if (item.reservation?.userId === userId) {
        outcome.alreadyMine.push(item);
        continue;
      }
      if (item.reservation) {
        outcome.taken.push({ item, byName: item.reservation.userName });
        continue;
      }
      const result = await this.repos.items.reserve(item.id, event.id, userId, userName);
      if (result.reserved) {
        outcome.reserved.push(result.reserved);
      } else if (result.alreadyMine) {
        outcome.alreadyMine.push(item);
      } else {
        outcome.taken.push({ item, byName: result.takenBy ?? 'другой участник' });
      }
    }

    const fresh = await this.repos.items.listByEvent(event.id);
    outcome.free = fresh.filter((item) => item.reservation === null);
    return outcome;
  }

  async release(itemId: string, userId: number): Promise<boolean> {
    return this.repos.items.release(itemId, userId);
  }

  /** Бронирование одной позиции по кнопке. */
  async reserveItem(
    event: DosugEvent,
    itemId: string,
    userId: number,
    userName: string,
  ): Promise<{ reserved: boolean; takenBy: string | null; alreadyMine: boolean }> {
    const item = await this.repos.items.findById(itemId);
    if (!item || item.eventId !== event.id) {
      return { reserved: false, takenBy: null, alreadyMine: false };
    }
    if (item.reservation?.userId === userId) {
      return { reserved: false, takenBy: null, alreadyMine: true };
    }
    if (item.reservation) {
      return { reserved: false, takenBy: item.reservation.userName, alreadyMine: false };
    }
    const result = await this.repos.items.reserve(itemId, event.id, userId, userName);
    return {
      reserved: result.reserved !== null,
      takenBy: result.takenBy,
      alreadyMine: result.alreadyMine,
    };
  }

  /** Фактическая сумма, которую участник заплатил за позицию. */
  async setPaidAmount(
    itemId: string,
    userId: number,
    paidKopecks: number | null,
  ): Promise<ItemWithReservation | null> {
    return this.repos.items.setPaidAmount(itemId, userId, paidKopecks);
  }

  async removeItem(itemId: string): Promise<boolean> {
    return this.repos.items.deleteItem(itemId);
  }
}

/** Разбирает ввод вида «1 2 3», «1,2,3», «1-3» в список номеров. */
export const parseItemNumbers = (input: string): number[] => {
  const numbers = new Set<number>();
  const parts = input
    .replace(/[;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  for (const part of parts) {
    const range = /^(\d{1,3})-(\d{1,3})$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from <= to && to - from <= 50) {
        for (let value = from; value <= to; value += 1) numbers.add(value);
        continue;
      }
    }
    const single = /^(\d{1,3})$/.exec(part);
    if (single) numbers.add(Number(single[1]));
  }

  return [...numbers].sort((a, b) => a - b);
};
