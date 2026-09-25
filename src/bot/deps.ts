import type { AppConfig } from '../config.js';
import type { Repositories } from '../db/repositories/index.js';
import type { Logger } from '../logger.js';
import type { DebugService } from '../services/debugService.js';
import type { EventService } from '../services/eventService.js';
import type { ItemService } from '../services/itemService.js';
import type { ParticipantService } from '../services/participantService.js';
import type { ProfileService } from '../services/profileService.js';
import type { ReminderService } from '../services/reminderService.js';
import type { SettlementService } from '../services/settlementService.js';
import type { TemplateService } from '../services/templateService.js';
import type { PgSessionStore } from '../db/sessions.js';
import type { AnswerMode } from '../domain/types.js';
import type { MiniappField } from '../miniapp/server.js';
import type { BotSession } from './session.js';
import type { Notifier } from './notifier.js';

/** Всё, что нужно обработчикам: конфиг, БД, сервисы, доставка сообщений. */
export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  repos: Repositories;
  profiles: ProfileService;
  events: EventService;
  participants: ParticipantService;
  items: ItemService;
  settlements: SettlementService;
  templates: TemplateService;
  reminders: ReminderService;
  /** Отладочные события с синтетическими людьми (команды debug*). */
  debug: DebugService;
  notifier: Notifier;
  /** Хранилище черновиков мастеров: нужно мини-приложению, чтобы записать поля. */
  sessions: PgSessionStore<BotSession>;
  /** Конструктор вопросов (мини-приложение). null — если выключен или адрес не задан. */
  miniapp: MiniappBridge | null;
}

/** Мост «бот → мини-приложение»: ссылка для кнопки и приём сохранённых полей. */
export interface MiniappBridge {
  /** Ссылка на конструктор: только одноразовая подпись, черновик страница берёт сама. */
  buildUrl: (ticket: string) => string;
  /** Подпись конструктора живёт в хранилище сессий: рестарт бота её не теряет. */
  registerTicket: (ticket: string, owner: { userId: number; at: number }) => Promise<void>;
  takeTicket: (ticket: string) => Promise<{ userId: number; at: number } | null>;
}
