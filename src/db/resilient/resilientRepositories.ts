import type { Logger } from '../../logger.js';
import type { DosugEvent, ItemWithReservation, Participant, Template, UserProfile } from '../../domain/types.js';
import type { MemoryStore } from '../memory/store.js';
import type { Repositories } from '../repositories/contracts.js';
import { isConnectionError, type ConnectionMonitor } from './connectionMonitor.js';

/**
 * Хранилище, которое не падает вместе с базой.
 *
 * Каждый вызов сначала идёт в PostgreSQL; успешный результат попутно кладётся
 * в память (зеркало), поэтому в памяти всегда есть недавно прочитанное.
 * Если база недоступна — вызов обслуживает память, а связь помечается как
 * потерянная: сторож начнёт «ныть» в логи и попробует восстановиться, после
 * чего данные из памяти уедут в базу.
 *
 * Бизнес-ошибки (например, нарушение уникальности) не считаются потерей связи
 * и уходят наверх как раньше: подменять их памятью нельзя.
 */

type Mirror = (store: MemoryStore, result: unknown) => void;

interface MethodSpec {
  /** Как положить успешный результат в память. */
  put?: Mirror;
  /** Метод без полезного результата (удаление, снятие брони) — повторяем вызов в памяти. */
  replay?: boolean;
}

type RepoSpec = Record<string, MethodSpec>;

const skipEmpty = (result: unknown): unknown[] => {
  if (result === null || result === undefined) return [];
  return Array.isArray(result) ? result : [result];
};

const putEvent: Mirror = (store, result) => {
  for (const item of skipEmpty(result)) store.putEvent(item as DosugEvent);
};
const putParticipant: Mirror = (store, result) => {
  for (const item of skipEmpty(result)) store.putParticipant(item as Participant);
};
const putItem: Mirror = (store, result) => {
  for (const item of skipEmpty(result)) store.putItem(item as ItemWithReservation);
};
const putTemplate: Mirror = (store, result) => {
  for (const item of skipEmpty(result)) store.putTemplate(item as Template);
};
const putUser: Mirror = (store, result) => {
  for (const item of skipEmpty(result)) store.putUser(item as UserProfile);
};

/** Что делать с результатом каждого метода: класть сущности или повторять вызов. */
const SPEC: Record<keyof Repositories, RepoSpec> = {
  users: {
    ensure: { put: putUser },
    find: { put: putUser },
    saveContact: { put: putUser },
    savePaymentDetails: { put: putUser },
    createdAt: {},
  },
  events: {
    create: { put: putEvent },
    findById: { put: putEvent },
    findByCode: { put: putEvent },
    listByOrganizer: { put: putEvent },
    listPublished: { put: putEvent },
    update: { put: putEvent },
    closeStartedBefore: { put: putEvent },
    listForUser: { put: putEvent },
  },
  items: {
    addMany: { put: putItem },
    listByEvent: { put: putItem },
    findById: { put: putItem },
    listReservedByUser: { put: putItem },
    // reserve возвращает обёртку: в память кладём саму позицию с бронью.
    reserve: { put: (store, result) => putItem(store, (result as { reserved?: unknown })?.reserved ?? null) },
    release: { replay: true },
    releaseAllForUser: { replay: true },
    setPaidAmount: { put: putItem },
    deleteItem: { replay: true },
  },
  participants: {
    upsert: { put: putParticipant },
    patch: { put: putParticipant },
    find: { put: putParticipant },
    listByEvent: { put: putParticipant },
    listByUser: { put: putParticipant },
    delete: { replay: true },
  },
  templates: {
    listByOwner: { put: putTemplate },
    find: { put: putTemplate },
    create: { put: putTemplate },
    rename: { put: putTemplate },
    updateFields: { put: putTemplate },
    delete: { replay: true },
  },
};

export interface StorageStats {
  /** postgres — работаем с базой, memory — база недоступна. */
  mode: 'postgres' | 'memory';
  online: boolean;
  /** Сколько вызовов обслужено из памяти из-за недоступной базы. */
  servedFromMemory: number;
  /** Сколько раз вызов переключался на память после ошибки соединения. */
  fallbacks: number;
  /** Объём зеркала в памяти. */
  counts: Record<string, number>;
}

export interface ResilientOptions {
  pg: Repositories;
  memory: Repositories;
  store: MemoryStore;
  monitor: ConnectionMonitor;
  logger: Logger;
}

export interface ResilientRepositories {
  repositories: Repositories;
  stats: () => StorageStats;
}

const wrapRepo = <T extends object>(
  name: string,
  pg: T,
  memory: T,
  spec: RepoSpec,
  context: {
    store: MemoryStore;
    monitor: ConnectionMonitor;
    logger: Logger;
    counters: { servedFromMemory: number; fallbacks: number };
  },
): T => {
  const mirror = (entry: MethodSpec, result: unknown, args: unknown[], memoryMethod: (...a: unknown[]) => unknown): void => {
    try {
      if (entry.put) entry.put(context.store, result);
      else if (entry.replay) void memoryMethod.apply(memory, args);
    } catch (error) {
      // Зеркало — вспомогательная структура: его сбой не должен ломать ответ.
      context.logger.warn(`Не удалось обновить зеркало в памяти (${name})`, error);
    }
  };

  return new Proxy(pg, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || typeof value !== 'function') return value;

      const entry = spec[property];
      if (!entry) return value.bind(target);

      const memoryValue = Reflect.get(memory as object, property) as unknown;
      if (typeof memoryValue !== 'function') return value.bind(target);
      const memoryMethod = memoryValue as (...a: unknown[]) => unknown;

      return async (...args: unknown[]): Promise<unknown> => {
        if (!context.monitor.isOnline()) {
          context.counters.servedFromMemory += 1;
          return memoryMethod.apply(memory, args);
        }

        try {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          mirror(entry, result, args, memoryMethod);
          return result;
        } catch (error) {
          if (!isConnectionError(error)) throw error;
          context.monitor.markOffline(error);
          context.counters.fallbacks += 1;
          context.counters.servedFromMemory += 1;
          context.logger.warn(
            `Запрос к PostgreSQL не прошёл (${name}.${property}) — выполняю в памяти.`,
          );
          return memoryMethod.apply(memory, args);
        }
      };
    },
  });
};

export const createResilientRepositories = (options: ResilientOptions): ResilientRepositories => {
  const counters = { servedFromMemory: 0, fallbacks: 0 };
  const context = {
    store: options.store,
    monitor: options.monitor,
    logger: options.logger,
    counters,
  };

  const repositories = Object.fromEntries(
    (Object.keys(SPEC) as Array<keyof Repositories>).map((key) => [
      key,
      wrapRepo(
        key,
        options.pg[key] as unknown as object,
        options.memory[key] as unknown as object,
        SPEC[key],
        context,
      ),
    ]),
  ) as unknown as Repositories;

  return {
    repositories,
    stats: () => ({
      mode: options.monitor.isOnline() ? 'postgres' : 'memory',
      online: options.monitor.isOnline(),
      servedFromMemory: counters.servedFromMemory,
      fallbacks: counters.fallbacks,
      counts: options.store.counts(),
    }),
  };
};

/** Короткая сводка для логов и /health. */
export const describeStorage = (stats: StorageStats): string => {
  const counts = Object.entries(stats.counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return `режим: ${stats.mode}, из памяти обслужено: ${stats.servedFromMemory}, `
    + `переключений: ${stats.fallbacks}, в зеркале: ${counts}`;
};
