import type { IncomingMessage, ServerResponse } from 'node:http';

import { renderAnswerPageHtml } from './answerPage.js';
import type { ParticipantStatus } from '../domain/types.js';
import type { MiniappDeps, MiniappTicket } from './contracts.js';
import { json, readBody } from './http.js';
import { identify } from './identity.js';
import { renderMiniappHtml } from './questionsPage.js';
import { sanitizeAnswerMode, sanitizeFields } from './sanitize.js';

/**
 * Маршруты мини-приложения: страницы конструктора и анкеты, API для черновика,
 * анкеты участника и сохранения ответов, health и вебхук MAX.
 *
 * Обработчик вызывается из HTTP-сервера (`server.ts`) и не знает про порт и
 * жизненный цикл процесса — только про `deps`.
 */
export const handleMiniappRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: MiniappDeps,
): Promise<void> => {
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

  if (req.method === 'GET' && url.pathname === '/app/draft') {
    // Черновик вопросов отдаём по подписи: URL конструктора остаётся коротким,
    // а повторное открытие не теряет уже собранные вопросы.
    const ticketValue = url.searchParams.get('t') ?? '';
    const ticket = ticketValue ? await deps.takeTicket(ticketValue) : null;
    if (!ticket) {
      json(res, 403, { error: 'Ссылка конструктора устарела. Откройте её заново из чата с ботом.' });
      return;
    }
    const draft = await deps.getDraft(ticket.userId);
    if (!draft) {
      json(res, 404, { error: 'Черновик не найден. Откройте конструктор из мастера создания события.' });
      return;
    }
    json(res, 200, draft);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app/answer') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderAnswerPageHtml({ title: 'Анкета участника' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app/api/questionnaire') {
    const identity = identify(
      deps,
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

    const identity = identify(deps,
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
    const ticket = ticketValue ? await deps.takeTicket(ticketValue) : null;
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
    const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 60) : '';
    try {
      // Подпись не гасим: организатор может сохранить ещё раз, пока она жива.
      await deps.onFieldsSaved(ticket.userId, fields, answerMode, name);
    } catch (saveError) {
      deps.logger.error('Не удалось сохранить вопросы из мини-приложения', saveError);
      json(res, 500, { error: 'Не удалось сохранить вопросы, попробуйте ещё раз' });
      return;
    }

    json(res, 200, { ok: true, count: fields.length, answerMode });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    // /health отвечает всегда, даже когда база недоступна: по нему видно,
    // что бот жив и работает в запасном режиме.
    json(res, 200, deps.health ? deps.health() : { ok: true });
    return;
  }

  json(res, 404, { error: 'not found' });};

/** Единая точка входа сервера: ошибки логируются, ответ не остаётся пустым. */
export const createMiniappHandler = (
  deps: MiniappDeps,
): ((req: IncomingMessage, res: ServerResponse) => void) => {
  return (req, res) => {
    void handleMiniappRequest(req, res, deps).catch((error: unknown) => {
      deps.logger.error('Ошибка HTTP-сервера мини-приложения', error);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    });
  };
};
