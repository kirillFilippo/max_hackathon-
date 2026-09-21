import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

import type { AnswerMode, EventField, FieldType, ParticipantStatus } from '../domain/types.js';
import { validateInitData } from './auth.js';
import { renderAnswerPageHtml } from './answerPage.js';
import { FIELD_TYPES } from '../domain/types.js';
import type { Logger } from '../logger.js';
import {
  MINIAPP_MAX_FIELDS,
  MINIAPP_MAX_LABEL,
  MINIAPP_MAX_OPTIONS,
  renderMiniappHtml,
  type MiniappTicket,
} from './questionsPage.js';

/** Поле, которым обмениваются бот и мини-приложение: домен без служебного id. */
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
  getQuestionnaire: (code: string, userId: number | null) => Promise<QuestionnairePayload | null>;
  saveAnswers: (submission: AnswerSubmission) => Promise<AnswerSaveResult>;
  /** Проверяет одноразовую подпись мастера (или null, если она истекла/неизвестна). */
  takeTicket: (ticket: string) => MiniappTicket | null;
  /** Вызывается после успешного сохранения: подпись гасится. */
  consumeTicket?: (ticket: string) => void;
  /** Вызывается ботом: сохранить поля в черновик организатора и обновить сообщение. */
  onFieldsSaved: (userId: number, fields: MiniappField[], answerMode: AnswerMode) => Promise<void>;
}

export interface MiniappHandle {
  url: string;
  port: number;
  /** Ссылка для кнопки open_app: страница конструктора с подписью и текущими полями. */
  buildUrl: (ticket: string, fields: MiniappField[], answerMode: AnswerMode) => string;
  registerTicket: (ticket: string, owner: MiniappTicket) => void;
  close: () => Promise<void>;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
};

const readBody = async (req: IncomingMessage, limit = 64 * 1024): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Слишком большой запрос');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const toBoundedNumber = (value: unknown, min: number, max: number): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, min), max);
};

/** Приводит присланные из мини-приложения вопросы к безопасному виду. */
const sanitizeFields = (raw: unknown): { fields: MiniappField[]; error?: string } => {
  if (!Array.isArray(raw)) return { fields: [], error: 'Ожидался список вопросов' };
  if (raw.length === 0) return { fields: [], error: 'Добавьте хотя бы один вопрос' };
  if (raw.length > MINIAPP_MAX_FIELDS) {
    return { fields: [], error: `Не больше ${MINIAPP_MAX_FIELDS} вопросов` };
  }

  const fields: MiniappField[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const label = typeof candidate.label === 'string' ? candidate.label.trim().slice(0, MINIAPP_MAX_LABEL) : '';
    if (!label) return { fields: [], error: 'У каждого вопроса должен быть текст' };

    const type = FIELD_TYPES.includes(candidate.type as FieldType) ? (candidate.type as FieldType) : 'text';
    const options = Array.isArray(candidate.options)
      ? candidate.options
          .filter((option): option is string => typeof option === 'string')
          .map((option) => option.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, MINIAPP_MAX_OPTIONS)
      : [];

    if (type === 'choice' && options.length < 2) {
      return { fields: [], error: `Для вопроса «${label}» нужно минимум два варианта` };
    }

    const multiple = type === 'choice' ? Boolean(candidate.multiple) : false;
    const minSelected = multiple ? toBoundedNumber(candidate.minSelected, 0, options.length) : null;
    const maxSelected = multiple
      ? toBoundedNumber(candidate.maxSelected, 1, options.length) ?? options.length
      : null;
    if (minSelected !== null && maxSelected !== null && minSelected > maxSelected) {
      return { fields: [], error: `У вопроса «${label}» минимум больше максимума` };
    }

    const min = type === 'number' ? toBoundedNumber(candidate.min, -1_000_000, 1_000_000) : null;
    const max = type === 'number' ? toBoundedNumber(candidate.max, -1_000_000, 1_000_000) : null;
    if (min !== null && max !== null && min > max) {
      return { fields: [], error: `У вопроса «${label}» минимум больше максимума` };
    }

    const maxLength = type === 'text' ? toBoundedNumber(candidate.maxLength, 1, 500) : null;

    fields.push({
      label,
      type,
      options,
      multiple,
      minSelected,
      maxSelected,
      min,
      max,
      maxLength,
      // Поля по умолчанию обязательные, как и просили: необязательность — осознанный выбор.
      required: candidate.required === undefined ? true : Boolean(candidate.required),
    });
  }

  if (fields.length === 0) return { fields: [], error: 'Добавьте хотя бы один вопрос' };
  return { fields };
};

const sanitizeAnswerMode = (raw: unknown): AnswerMode =>
  raw === 'chat' || raw === 'miniapp' ? raw : 'auto';

/**
 * HTTP-сервер мини-приложения конструктора вопросов. Живёт в том же процессе, что и
 * бот, поэтому отдельного сервиса в compose не требуется: страница и API — на одном
 * порту (MINIAPP_PORT).
 */
export const startMiniappServer = async (deps: MiniappDeps): Promise<MiniappHandle> => {
  const tickets = new Map<string, MiniappTicket>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      // Вебхук MAX обслуживаем первым и не читаем тело: его читает SDK.
      if (deps.webhookHandler && deps.webhookPath && url.pathname === deps.webhookPath) {
        deps.webhookHandler(req, res);
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app/questions')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderMiniappHtml({ title: 'Вопросы участникам' }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/app/answer') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderAnswerPageHtml({ title: 'Анкета участника' }));
        return;
      }

      // Кто открыл приложение: подпись запуска проверяем на сервере.
      const identify = (
        initDataValue: string,
        devUserId?: string | null,
      ): { userId: number | null; name: string; username: string | null; error?: string } => {
        if (deps.devMode && !initDataValue) {
          const id = Number(devUserId ?? '1');
          return { userId: Number.isFinite(id) ? id : 1, name: 'Тестовый участник', username: null };
        }
        const check = validateInitData(initDataValue, deps.botToken);
        if (!check.ok || !check.data.user) {
          return { userId: null, name: '', username: null, error: check.reason ?? 'Не удалось проверить подпись запуска' };
        }
        const user = check.data.user;
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Участник';
        return { userId: user.id, name, username: user.username ?? null };
      };

      if (req.method === 'GET' && url.pathname === '/app/api/questionnaire') {
        const identity = identify(
          url.searchParams.get('initData') ?? '',
          url.searchParams.get('devUserId'),
        );
        const code = (url.searchParams.get('code') ?? '').trim().toUpperCase();
        if (!code) {
          json(res, 400, { error: 'Не указан код события' });
          return;
        }
        if (identity.error) {
          json(res, 403, { error: identity.error });
          return;
        }
        const payload = await deps.getQuestionnaire(code, identity.userId);
        if (!payload) {
          json(res, 404, { error: `Событие ${code} не найдено` });
          return;
        }
        const me = {
          ...payload.me,
          name: payload.me.name || identity.name,
        };
        json(res, 200, { event: payload.event, fields: payload.fields, me });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/app/answers') {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(await readBody(req)) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'Некорректный JSON' });
          return;
        }

        const identity = identify(
          typeof parsed.initData === 'string' ? parsed.initData : '',
          typeof parsed.devUserId === 'string' ? parsed.devUserId : null,
        );
        if (identity.error || identity.userId === null) {
          json(res, 403, { error: identity.error ?? 'Не удалось определить пользователя' });
          return;
        }

        const code = typeof parsed.code === 'string' ? parsed.code.trim().toUpperCase() : '';
        if (!code) {
          json(res, 400, { error: 'Не указан код события' });
          return;
        }

        const answers =
          typeof parsed.answers === 'object' && parsed.answers !== null
            ? Object.fromEntries(
                Object.entries(parsed.answers as Record<string, unknown>)
                  .filter(([, value]) => typeof value === 'string')
                  .map(([key, value]) => [key, String(value).slice(0, 500)]),
              )
            : {};
        const rawStatus = typeof parsed.status === 'string' ? parsed.status : 'going';
        const status: ParticipantStatus =
          rawStatus === 'maybe' || rawStatus === 'not_going' ? rawStatus : 'going';

        const result = await deps.saveAnswers({
          code,
          userId: identity.userId,
          name: (typeof parsed.name === 'string' && parsed.name.trim()) || identity.name,
          username: identity.username,
          contact: typeof parsed.contact === 'string' ? parsed.contact.trim().slice(0, 120) : '',
          status,
          answers,
        });

        if (!result.ok) {
          json(res, 400, { error: result.error, fieldId: result.fieldId });
          return;
        }
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/app/fields') {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(await readBody(req)) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'Некорректный JSON' });
          return;
        }

        const ticketValue = typeof parsed.ticket === 'string' ? parsed.ticket : '';
        const ticket = ticketValue ? deps.takeTicket(ticketValue) : null;
        if (!ticket) {
          json(res, 403, { error: 'Ссылка конструктора устарела. Откройте её заново из чата с ботом.' });
          return;
        }

        const { fields, error } = sanitizeFields(parsed.fields);
        if (error) {
          json(res, 400, { error });
          return;
        }

        const answerMode = sanitizeAnswerMode(parsed.answerMode);
        try {
          await deps.onFieldsSaved(ticket.userId, fields, answerMode);
          deps.consumeTicket?.(ticketValue);
        } catch (saveError) {
          deps.logger.error('Не удалось сохранить вопросы из мини-приложения', saveError);
          json(res, 500, { error: 'Не удалось сохранить вопросы, попробуйте ещё раз' });
          return;
        }

        json(res, 200, { ok: true, count: fields.length, answerMode });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true });
        return;
      }

      json(res, 404, { error: 'not found' });
    })().catch((error) => {
      deps.logger.error('Ошибка HTTP-сервера мини-приложения', error);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.port ?? Number(process.env.MINIAPP_PORT ?? 8090), '0.0.0.0', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

  const baseUrl = deps.baseUrl.replace(/\/$/, '');

  return {
    url: baseUrl,
    port,
    buildUrl: (ticket: string, fields: MiniappField[], answerMode: AnswerMode) => {
      const payload = Buffer.from(JSON.stringify(fields), 'utf8').toString('base64');
      const params = new URLSearchParams({ t: ticket, d: payload, m: answerMode });
      return `${baseUrl}/app/questions?${params.toString()}`;
    },
    registerTicket: (ticket: string, owner: MiniappTicket) => {
      tickets.set(ticket, owner);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

export const newTicket = (): string => randomBytes(12).toString('hex');
