import { randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

import type { AppDeps } from '../src/bot/deps.js';
import { createApiNotifier } from '../src/bot/notifier.js';
import { makeFakeNotifier, type FakeNotifier } from './fakeNotifier.js';
import type { BotSession } from '../src/bot/session.js';
import type { AppConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createDb, type Db } from '../src/db/pool.js';
import { createRepositories, type Repositories } from '../src/db/repositories/index.js';
import { PgSessionStore } from '../src/db/sessions.js';
import { createLogger, type Logger } from '../src/logger.js';
import { EventService } from '../src/services/eventService.js';
import { ItemService } from '../src/services/itemService.js';
import { ParticipantService } from '../src/services/participantService.js';
import { ProfileService } from '../src/services/profileService.js';
import { ReminderService } from '../src/services/reminderService.js';
import { SettlementService } from '../src/services/settlementService.js';
import { TemplateService } from '../src/services/templateService.js';

export type { FakeNotifier };

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  botToken: 'test-token',
  botMode: 'polling',
  webhookPath: '/max/webhook',
  webhookPort: 8080,
  databaseUrl: 'postgres://postgres:postgres@localhost:5432/postgres',
  databasePoolSize: 4,
  databaseSsl: false,
  miniappUrl: undefined,
  miniappPort: 8090,
  miniappDev: true,
  appTz: 'Europe/Moscow',
  botUsername: 'DosugTestBot',
  reminderConfirmHours: 48,
  reminderFinalHours: 1,
  reminderTickSeconds: 60,
  sessionTtlHours: 24,
  logLevel: 'error',
  ...overrides,
});

const freePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Не удалось получить свободный порт')));
      }
    });
  });

export interface Harness {
  db: Db;
  repos: Repositories;
  config: AppConfig;
  logger: Logger;
  deps: AppDeps;
  profiles: ProfileService;
  events: EventService;
  participants: ParticipantService;
  items: ItemService;
  settlements: SettlementService;
  templates: TemplateService;
  reminders: ReminderService;
  sessionStore: PgSessionStore<BotSession>;
  notifier: FakeNotifier;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Поднимает настоящий PostgreSQL (бинарь из embedded-postgres), применяет миграции
 * и собирает сервисы — тесты проверяют реальный SQL, а не заглушку.
 */
export const startHarness = async (overrides: Partial<AppConfig> = {}): Promise<Harness> => {
  const port = await freePort();
  const databaseDir = path.join(os.tmpdir(), `dosug-pg-${randomUUID()}`);
  const cluster = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await cluster.initialise();
  await cluster.start();

  const config = testConfig({
    ...overrides,
    databaseUrl: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
  });
  const logger = createLogger('error');
  const db = createDb(
    { connectionString: config.databaseUrl, maxConnections: config.databasePoolSize },
    logger,
  );
  await migrate(db, logger);

  const repos = createRepositories(db);
  const profiles = new ProfileService(repos);
  const events = new EventService(repos, config);
  const participants = new ParticipantService(repos);
  const items = new ItemService(repos);
  const settlements = new SettlementService(repos);
  const templates = new TemplateService(repos);
  const reminders = new ReminderService(repos, config);
  const sessionStore = new PgSessionStore<BotSession>(db, config.sessionTtlHours * 3_600_000);
  const notifier = makeFakeNotifier();

  const deps: AppDeps = {
    config,
    logger,
    repos,
    profiles,
    events,
    participants,
    items,
    settlements,
    templates,
    reminders,
    notifier,
    sessions: sessionStore,
    miniapp: null,
  };

  return {
    db,
    repos,
    config,
    logger,
    deps,
    profiles,
    events,
    participants,
    items,
    settlements,
    templates,
    reminders,
    sessionStore,
    notifier,
    reset: async () => {
      await db.query(
        'TRUNCATE transfer_requests, reservations, event_items, participants, events, templates, users, sessions CASCADE',
      );
      notifier.messages.length = 0;
    },
    stop: async () => {
      await db.close();
      await cluster.stop();
    },
  };
};

export const hoursFromNow = (hours: number, from = new Date()): string =>
  new Date(from.getTime() + hours * 3_600_000).toISOString();

export const createEvent = async (
  harness: Harness,
  overrides: Partial<Parameters<EventService['create']>[0]> = {},
) =>
  harness.events.create({
    title: 'Настолки в пятницу',
    description: 'Берём свои настолки',
    startsAt: hoursFromNow(72),
    place: 'антикафе Кубик, ул. Ленина 5',
    placeCoords: null,
    limit: null,
    fields: [],
    organizerId: 100,
    organizerName: 'Оля',
    ...overrides,
  });

export const register = async (
  harness: Harness,
  eventId: string,
  userId: number,
  name: string,
  status: 'going' | 'maybe' | 'not_going' = 'going',
) => {
  const event = await harness.events.findById(eventId);
  if (!event) throw new Error('событие не найдено');
  const outcome = await harness.participants.save({
    event,
    userId,
    name,
    username: null,
    contact: '',
    status,
    answers: {},
  });
  if (!outcome.ok) throw new Error(`Ответ не прошёл проверку: ${outcome.error}`);
  return outcome;
};

export { createApiNotifier };
