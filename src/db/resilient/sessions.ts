import type { AsyncSessionStore } from '@maxhub/max-bot-api';

import type { Logger } from '../../logger.js';
import type { PgSessionStore } from '../sessions.js';
import { isConnectionError, type ConnectionState } from './connectionMonitor.js';

/**
 * Сессии (черновики мастеров) с запасным хранилищем в памяти.
 *
 * Черновик мастера — это состояние диалога: без него бот не помнит, на каком
 * шаге пользователь. Пока база доступна, сессии лежат в PostgreSQL (переживают
 * перезапуск), при обрыве связи — в памяти процесса: мастер продолжает работать,
 * а после восстановления связи сессии из памяти переезжают в базу.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class ResilientSessionStore<T extends object> implements AsyncSessionStore<T> {
  private readonly memory = new Map<string, Entry<T>>();

  constructor(
    private readonly pg: PgSessionStore<T>,
    private readonly monitor: ConnectionState,
    private readonly logger: Logger,
    private readonly ttlMs: number,
  ) {}

  private putToMemory(key: string, value: T): void {
    this.memory.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  private readFromMemory(key: string): T | undefined {
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Черновики, которые появились в памяти за время обрыва: их надо донести в базу. */
  async flushToPg(): Promise<number> {
    if (this.memory.size === 0) return 0;
    let moved = 0;
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt <= Date.now()) {
        this.memory.delete(key);
        continue;
      }
      try {
        await this.pg.set(key, entry.value);
        // Из памяти не удаляем: пока связь не подтверждена, чтение идёт из неё,
        // а черновик и так исчезнет по TTL (и при плановой очистке).
        moved += 1;
      } catch (error) {
        if (!isConnectionError(error)) this.logger.warn('Не удалось перенести черновик в базу', error);
        break;
      }
    }
    if (moved > 0) this.logger.info(`Черновики мастеров перенесены в PostgreSQL: ${moved}.`);
    return moved;
  }

  async get(key: string): Promise<T | undefined> {
    if (!this.monitor.isOnline()) return this.readFromMemory(key);
    try {
      const value = await this.pg.get(key);
      if (value !== undefined) this.putToMemory(key, value);
      return value;
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      this.monitor.markOffline(error);
      return this.readFromMemory(key);
    }
  }

  async set(key: string, value: T): Promise<void> {
    // В память пишем всегда: это дешёвая страховка на случай обрыва.
    this.putToMemory(key, value);
    if (!this.monitor.isOnline()) return;
    try {
      await this.pg.set(key, value);
      this.memory.delete(key);
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      this.monitor.markOffline(error);
    }
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    if (!this.monitor.isOnline()) return;
    try {
      await this.pg.delete(key);
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      this.monitor.markOffline(error);
    }
  }

  /** Мини-приложение ищет черновик по пользователю, не зная чат. */
  async findByUser(userId: number): Promise<Array<{ key: string; value: T }>> {
    const fromMemory = [...this.memory.entries()]
      .filter(([key, entry]) => key.startsWith(`${userId}:`) && entry.expiresAt > Date.now())
      .map(([key, entry]) => ({ key, value: entry.value }));

    if (!this.monitor.isOnline()) return fromMemory;

    try {
      const rows = await this.pg.findByUser(userId);
      for (const row of rows) this.putToMemory(row.key, row.value);
      const merged = new Map(fromMemory.map((row) => [row.key, row]));
      for (const row of rows) merged.set(row.key, row);
      return [...merged.values()];
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      this.monitor.markOffline(error);
      return fromMemory;
    }
  }

  async cleanupExpired(): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt <= Date.now()) {
        this.memory.delete(key);
        removed += 1;
      }
    }
    if (!this.monitor.isOnline()) return removed;
    try {
      return removed + (await this.pg.cleanupExpired());
    } catch (error) {
      if (!isConnectionError(error)) throw error;
      this.monitor.markOffline(error);
      return removed;
    }
  }
}
