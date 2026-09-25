import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { createMemoryRepositories, MemoryStore } from './memory/index.js';
import { migrate } from './migrate.js';
import { createDb, type Db } from './pool.js';
import { createRepositories } from './repositories/index.js';
import type { Repositories } from './repositories/contracts.js';
import { PgSessionStore } from './sessions.js';
import { ConnectionMonitor } from './resilient/connectionMonitor.js';
import { hydrateMemory } from './resilient/hydrate.js';
import { createOfflineStateFile, type OfflineStateFile } from './resilient/offlineFile.js';
import {
  createResilientRepositories,
  describeStorage,
  type StorageStats,
} from './resilient/resilientRepositories.js';
import { ResilientSessionStore } from './resilient/sessions.js';
import { syncMemoryToDb } from './resilient/sync.js';

/**
 * Сборка хранилища: PostgreSQL, память или гибрид.
 *
 * `postgres` — как раньше: база обязательна, без неё бот не стартует (строгий
 * режим для тех, кому важнее упасть, чем работать с неполными данными).
 * `memory`   — база не используется вовсе: удобно для демонстрации и локальных
 *              прогонов, данные живут до перезапуска процесса.
 * `auto`     — по умолчанию: работаем с базой, но переживаем её пропажу.
 *              Запросы обслуживает память, сторож «ноет» в логи, а после
 *              восстановления связи данные уезжают в PostgreSQL.
 */

/** Общий вид хранилища сессий: одинаковый у PostgreSQL и у памяти. */
export interface SessionsStore<T extends object> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  findByUser(userId: number): Promise<Array<{ key: string; value: T }>>;
  cleanupExpired(): Promise<number>;
}

export interface Storage {
  db: Db;
  repositories: Repositories;
  sessions: SessionsStore<object>;
  monitor: ConnectionMonitor;
  store: MemoryStore;
  stats: () => StorageStats;
  /** Запуск фоновых задач хранилища: сторож соединения и снимки памяти. */
  start: () => void;
  stop: () => Promise<void>;
}

/** Снимок памяти на диск: только пока связи нет и есть что писать. */
const startOfflineSnapshots = (
  monitor: ConnectionMonitor,
  store: MemoryStore,
  file: OfflineStateFile,
  logger: Logger,
): NodeJS.Timeout => {
  const timer = setInterval(() => {
    if (monitor.isOnline() || store.isEmpty()) return;
    file.save(store.snapshot());
  }, 10_000);
  timer.unref?.();
  return timer;
};

export const createStorage = async (config: AppConfig, logger: Logger): Promise<Storage> => {
  const db = createDb(
    {
      connectionString: config.databaseUrl,
      maxConnections: config.databasePoolSize,
      ssl: config.databaseSsl,
    },
    logger,
  );

  // Строгий режим: прежнее поведение, память не участвует.
  if (config.storageMode === 'postgres') {
    await db.ping();
    await migrate(db, logger);
    const monitor = new ConnectionMonitor(db, logger, {});
    return {
      db,
      repositories: createRepositories(db),
      sessions: new PgSessionStore<object>(db, config.sessionTtlHours * 3_600_000) as SessionsStore<object>,
      monitor,
      store: new MemoryStore(),
      stats: () => ({ mode: 'postgres', online: true, servedFromMemory: 0, fallbacks: 0, counts: {} }),
      start: () => undefined,
      stop: async () => {
        await db.close();
      },
    };
  }

  const store = new MemoryStore();
  const memoryRepositories = createMemoryRepositories(store);
  const pgRepositories = createRepositories(db);
  const offlineFile = config.offlineStatePath
    ? createOfflineStateFile(config.offlineStatePath, logger)
    : null;

  // Сторож создаётся первым, а перенос черновиков подключается к нему после
  // создания хранилища сессий — через изменяемую ссылку, без приведения типов.
  let flushSessions = async (): Promise<void> => undefined;

  const monitor = new ConnectionMonitor(db, logger, {
    checkIntervalMs: config.storageCheckSeconds * 1000,
    heartbeatMs: Math.max(config.storageCheckSeconds * 1000, 30_000),
    describeState: () => (store.isEmpty()
      ? 'В памяти пока пусто.'
      : `Ждут синхронизации: ${Object.entries(store.counts()).map(([key, value]) => `${key}=${value}`).join(', ')}.`),
    onRecovered: async () => {
      // Порядок важен: схема → данные из памяти → черновики → свежий прогрев.
      await migrate(db, logger);
      await syncMemoryToDb(db, store, logger);
      await flushSessions();
      await hydrateMemory(pgRepositories, store, logger);
      offlineFile?.clear();
    },
  });

  const sessions = new ResilientSessionStore<object>(
    new PgSessionStore<object>(db, config.sessionTtlHours * 3_600_000),
    monitor,
    logger,
    config.sessionTtlHours * 3_600_000,
  );
  flushSessions = async () => {
    await sessions.flushToPg();
  };

  const resilient = createResilientRepositories({
    pg: pgRepositories,
    memory: memoryRepositories,
    store,
    monitor,
    logger,
  });

  if (config.storageMode === 'memory') {
    logger.warn(
      'STORAGE_MODE=memory: база не используется, все данные живут в памяти процесса. '
        + 'Это режим демонстрации и отладки, а не реальной работы.',
    );
    const restored = offlineFile?.load() ?? null;
    if (restored) store.restore(restored);
  } else {
    const online = await monitor.probe();
    if (online) {
      await migrate(db, logger);
      // Снимок прошлого запуска: данные, созданные без базы, надо донести до неё.
      const restored = offlineFile?.load() ?? null;
      if (restored) {
        store.restore(restored);
        await syncMemoryToDb(db, store, logger);
        offlineFile?.clear();
      }
      await hydrateMemory(pgRepositories, store, logger);
      const removedSessions = await sessions.cleanupExpired();
      if (removedSessions > 0) logger.info(`Удалено просроченных сессий: ${removedSessions}`);
    } else if (offlineFile?.exists()) {
      const restored = offlineFile.load();
      if (restored) store.restore(restored);
      logger.warn('База недоступна при старте: поднимаю данные из офлайн-снимка на диске.');
    }
  }

  let snapshots: NodeJS.Timeout | null = null;

  return {
    db,
    repositories: resilient.repositories,
    sessions,
    monitor,
    store,
    stats: resilient.stats,
    start: () => {
      monitor.start();
      if (config.storageMode === 'auto' && offlineFile) {
        snapshots = startOfflineSnapshots(monitor, store, offlineFile, logger);
      }
      logger.info(`Хранилище готово: ${describeStorage(resilient.stats())}.`);
    },
    stop: async () => {
      monitor.stop();
      if (snapshots) clearInterval(snapshots);
      // Остановка при недоступной базе: пишем снимок, чтобы не потерять данные.
      if (config.storageMode !== 'postgres' && !monitor.isOnline() && !store.isEmpty()) {
        offlineFile?.save(store.snapshot());
        logger.warn('Остановка без базы: данные сохранены в офлайн-снимок.');
      }
      await db.close();
    },
  };
};
