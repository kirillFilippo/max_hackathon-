import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AnswerMode, EventField, FieldType, ParticipantStatus } from '../domain/types.js';
import type { Logger } from '../logger.js';

/**
 * Контракты мини-приложения: что бот отдаёт странице и что страница присылает
 * обратно. Лежат отдельно от HTTP-сервера, чтобы `app.ts` и слой бота не зависели
 * от реализации маршрутов.
 */

/**
 * Пропуск конструктора вопросов: кто, из какого чата и в какой сессии мастера
 * открыл приложение.
 *
 * `chatId` и `sessionKey` обязательны: по сессии конструктор находит «свой»
 * черновик (у пользователя их может быть несколько — по одному на чат), а по чату
 * бот присылает обратно обновлённый экран. Пропуск без этих полей считается
 * недействительным, а не «угадывается» по первому подходящему черновику.
 */
export interface MiniappTicket {
  userId: number;
  /** Чат, из которого открыли конструктор. */
  chatId: number;
  /** Ключ сессии мастера (`userId:chatId`). */
  sessionKey: string;
  at: number;
}

export interface MiniappField {
  label: string;
  type: FieldType;
  options: string[];
  multiple: boolean;
  minSelected: number | null;
  maxSelected: number | null;
  min: number | null;
  max: number | null;
  maxLength: number | null;
  required: boolean;
}

/** Анкета для мини-приложения: событие, вопросы и прошлые ответы участника. */
export interface QuestionnairePayload {
  event: { code: string; title: string; startsAt: string; place: string };
  fields: EventField[];
  me: {
    name: string;
    contact: string;
    status: ParticipantStatus;
    answers: Record<string, string>;
  };
}

export interface AnswerSubmission {
  code: string;
  userId: number;
  name: string;
  username: string | null;
  contact: string;
  status: ParticipantStatus;
  answers: Record<string, string>;
}

export type AnswerSaveResult = { ok: true } | { ok: false; error: string; fieldId?: string };

/** Черновик вопросов организатора, который конструктор подтягивает по подписи. */
export interface MiniappDraft {
  fields: MiniappField[];
  answerMode: AnswerMode;
  name: string;
}

export interface MiniappDeps {
  /**
   * Путь вебхука MAX (например, /max/webhook). Если задан вместе с webhookHandler,
   * сервер мини-приложения обслуживает и апдейты бота — тогда наружу нужен один
   * порт и один публичный маршрут.
   */
  webhookPath?: string;
  /** Обработчик апдейтов MAX из SDK (bot.createWebhook). */
  webhookHandler?: (req: IncomingMessage, res: ServerResponse) => void;
  logger: Logger;
  /** Публичный HTTPS-адрес мини-приложения (его же указывают в настройках бота). */
  baseUrl: string;
  /** Локальный порт HTTP-сервера; 0 — выбрать свободный (используется в тестах). */
  port?: number;
  botToken: string;
  /** Локальная отладка: разрешает работу без подписи (не включать в проде). */
  devMode: boolean;
  /** Состояние хранилища для /health: режим, обрыв связи, очередь синхронизации. */
  health?: () => Record<string, unknown>;
  getQuestionnaire: (code: string, userId: number | null) => Promise<QuestionnairePayload | null>;
  saveAnswers: (submission: AnswerSubmission) => Promise<AnswerSaveResult>;
  /** Проверяет одноразовую подпись мастера (или null, если она истекла/неизвестна). */
  takeTicket: (ticket: string) => Promise<MiniappTicket | null>;
  /** Текущий черновик организатора: его конструктор подтягивает по подписи. */
  getDraft: (ticket: MiniappTicket) => Promise<MiniappDraft | null>;
  /** Вызывается ботом: сохранить поля в черновик организатора и обновить сообщение. */
  onFieldsSaved: (
    ticket: MiniappTicket,
    fields: MiniappField[],
    answerMode: AnswerMode,
    name: string,
  ) => Promise<void>;
}

export interface MiniappHandle {
  url: string;
  port: number;
  /**
   * Ссылка для кнопки open_app: только одноразовая подпись. Черновик страница
   * забирает сама (GET /app/draft), поэтому URL короткий и не ломается
   * на длинных анкетах.
   */
  buildUrl: (ticket: string) => string;
  close: () => Promise<void>;
}
