import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { startMiniappServer, type MiniappField, type MiniappHandle } from '../src/miniapp/server.js';
import { newTicket } from '../src/miniapp/server.js';
import { MINIAPP_CHAT_WEIGHT_LIMIT, MINIAPP_MAX_FIELDS } from '../src/miniapp/questionsPage.js';
import type { AnswerMode } from '../src/domain/types.js';
import { createHmac } from 'node:crypto';

import { createLogger } from '../src/logger.js';
import { validateInitData } from '../src/miniapp/auth.js';

interface SavedPayload {
  userId: number;
  fields: MiniappField[];
  answerMode: AnswerMode;
  name: string;
}

const draftFields: MiniappField[] = [
  {
    label: 'Возраст',
    type: 'number',
    options: [],
    multiple: false,
    minSelected: null,
    maxSelected: null,
    min: 6,
    max: 99,
    maxLength: null,
    required: true,
  },
];

let handle: MiniappHandle;
let saved: SavedPayload[] = [];
const savedAnswers: Array<{ code: string; userId: number }> = [];
const validTickets = new Map<string, number>();

before(async () => {
  handle = await startMiniappServer({
    logger: createLogger('error'),
    baseUrl: 'https://example.test',
    port: 0,
    botToken: 'test-bot-token',
    devMode: true,
    getDraft: async (userId) => (userId === 7
      ? { fields: draftFields, answerMode: 'chat', name: 'Настольная игра' }
      : null),
    getQuestionnaire: async (code) => (code === 'ABC12'
      ? {
          event: { code: 'ABC12', title: 'Настолки', startsAt: '25 октября 2026, 19:00', place: 'Кубик' },
          fields: [],
          me: { name: 'Аня', contact: '', status: 'going', answers: {} },
        }
      : null),
    saveAnswers: async (submission) => {
      savedAnswers.push(submission);
      return { ok: true };
    },
    takeTicket: async (ticket) => {
      const at = validTickets.get(ticket);
      if (at === undefined) return null;
      return { userId: 7, at };
    },
    onFieldsSaved: async (userId, fields, answerMode, name) => {
      saved.push({ userId, fields, answerMode, name });
    },
  });
});

after(async () => {
  await handle.close();
});

const post = async (body: unknown): Promise<{ status: number; data: Record<string, unknown> }> => {
  const response = await fetch(`http://127.0.0.1:${handle.port}/app/fields`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
};

describe('Мини-приложение конструктора вопросов', () => {
  it('отдаёт страницу с ограничениями и скрытой настройкой способа ответа', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/app/questions`);
    const html = await response.text();

    assert.equal(response.status, 200);
    // Все типы вопросов, включая дату, и ограничения как в формах.
    for (const capability of ['Число', 'Дата', 'Максимум', 'Максимальная длина', 'Можно выбрать несколько']) {
      assert.match(html, new RegExp(capability));
    }
    // Название набора для шаблона — прямо в конструкторе.
    assert.match(html, /Название набора/);
    assert.match(html, /id="name"/);
    // Черновик страница забирает по подписи, а не из base64 в URL.
    assert.match(html, /app\/draft\?t=/);
    assert.match(html, /Загрузка…/);
    assert.match(html, /Сохраняем…/);
    assert.match(html, /saveButton\.disabled = true/);
    assert.match(html, /Вернуться в чат/);
    // Настройка способа ответа спрятана в свёрнутый блок, но доступна организатору.
    assert.match(html, /<details class="mode">/);
    assert.match(html, /Способ ответа участников/);
    assert.match(html, /Автоматически/);
    // Внутренний вес анкеты в интерфейсе не показываем.
    assert.doesNotMatch(html, /Вес вопросов|порог 10/i);
    assert.match(html, new RegExp(String(MINIAPP_CHAT_WEIGHT_LIMIT)));
    assert.match(html, /https:\/\/st\.max\.ru\/js\/max-web-app\.js|WebApp/);
    // Подпись мастера приходит и ссылкой мини-приложения (start_param), и через ?t=.
    assert.match(html, /start_param/);
    assert.match(html, /tpl_/);
    // Без WebApp.ready() вебвью MAX может остаться на экране загрузки.
    assert.match(html, /WebApp\.ready\(\)/);
    // Анкета участника живёт на той же странице — уводим её по start_param.
    assert.match(html, /\/app\/answer/);
  });

  it('сохраняет ограничения и способ ответа, приводя данные к безопасному виду', async () => {
    saved = [];
    const ticket = newTicket();
    validTickets.set(ticket, Date.now());

    const { status, data } = await post({
      ticket,
      answerMode: 'miniapp',
      name: 'Поход в леса',
      fields: [
        { label: '  Возраст  ', type: 'number', min: '6', max: '99', required: true },
        { label: 'Дата заезда', type: 'date', required: true },
        {
          label: 'Что принесёте?',
          type: 'choice',
          options: ['Снеки', 'Напитки', 'Настолка', 'Ничего', 'Лишнее'],
          multiple: true,
          minSelected: '1',
          maxSelected: '2',
        },
        { label: 'Комментарий', type: 'text', maxLength: '5000', required: false },
      ],
    });

    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.userId, 7);
    assert.equal(saved[0]?.answerMode, 'miniapp');
    assert.equal(saved[0]?.name, 'Поход в леса');

    const fields = saved[0]!.fields;
    assert.equal(fields.length, 4);
    assert.equal(fields[0]?.label, 'Возраст');
    assert.equal(fields[0]?.min, 6);
    assert.equal(fields[0]?.max, 99);
    assert.equal(fields[0]?.required, true);
    assert.equal(fields[1]?.type, 'date');
    // Поле без явного required считается обязательным — как договорились.
    assert.equal(fields[1]?.required, true);
    assert.equal(fields[2]?.multiple, true);
    assert.equal(fields[2]?.minSelected, 1);
    assert.equal(fields[2]?.maxSelected, 2);
    // Длина текста ограничена сверху, чтобы не сломать интерфейс и БД.
    assert.equal(fields[3]?.maxLength, 500);
    assert.equal(fields[3]?.required, false);
  });

  it('разрешает сохранять повторно по той же подписи и не пускает без неё', async () => {
    const ticket = newTicket();
    validTickets.set(ticket, Date.now());

    const first = await post({
      ticket,
      fields: [{ label: 'Вопрос', type: 'text', required: true }],
    });
    assert.equal(first.status, 200);

    // Повторное сохранение — обычный сценарий: поправил вопросы и сохранил снова.
    const second = await post({
      ticket,
      fields: [{ label: 'Вопрос', type: 'text', required: true }],
    });
    assert.equal(second.status, 200);

    const withoutTicket = await post({ fields: [{ label: 'Вопрос', type: 'text' }] });
    assert.equal(withoutTicket.status, 403);
  });

  it('отдаёт черновик организатору по подписи', async () => {
    const ticket = newTicket();
    validTickets.set(ticket, Date.now());

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/app/draft?t=${encodeURIComponent(ticket)}`,
    );
    const data = (await response.json()) as {
      fields?: Array<{ label?: string }>;
      answerMode?: string;
      name?: string;
    };

    assert.equal(response.status, 200);
    assert.equal(data.fields?.[0]?.label, 'Возраст');
    assert.equal(data.answerMode, 'chat');
    assert.equal(data.name, 'Настольная игра');

    const stale = await fetch(`http://127.0.0.1:${handle.port}/app/draft?t=unknown`);
    assert.equal(stale.status, 403);
  });

  it('валидирует присланные вопросы', async () => {
    const ticket = newTicket();
    validTickets.set(ticket, Date.now());

    const noOptions = await post({
      ticket,
      fields: [{ label: 'Выбор', type: 'choice', options: ['один'], required: true }],
    });
    assert.equal(noOptions.status, 400);
    assert.match(String(noOptions.data.error), /минимум два варианта/);

    const emptyLabel = await post({ ticket, fields: [{ label: '   ', type: 'text' }] });
    assert.equal(emptyLabel.status, 400);

    const tooMany = await post({
      ticket,
      fields: Array.from({ length: MINIAPP_MAX_FIELDS + 1 }, (_, index) => ({
        label: `Вопрос ${index}`,
        type: 'yesno',
        required: true,
      })),
    });
    assert.equal(tooMany.status, 400);

    const badRange = await post({
      ticket,
      fields: [{ label: 'Возраст', type: 'number', min: 10, max: 5, required: true }],
    });
    assert.equal(badRange.status, 400);
  });

  it('отдаёт health для проверки живости', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
    assert.equal(response.status, 200);
  });
});

describe('Анкета участника в мини-приложении', () => {
  it('отдаёт страницу анкеты и подключает MAX Bridge', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/app/answer`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /https:\/\/st\.max\.ru\/js\/max-web-app\.js/);
    assert.match(html, /start_param/);
    assert.match(html, /app\/answers/);
    // Конструктор вопросов открывается тем же мини-приложением — уводим по start_param.
    assert.match(html, /tpl_/);
    assert.match(html, /\/app\/questions\?t=/);
    assert.match(html, /WebApp\.ready\(\)/);
    // Выбор нескольких вариантов не должен терять уже отмеченное: состояние берём
    // из ответов в момент нажатия, а не из разметки.
    assert.match(html, /currentSelection\(field\)/);
    assert.doesNotMatch(html, /new Set\(selected\)/);
    // Понятные состояния: загрузка, ошибка без подписи запуска, возврат в чат.
    assert.match(html, /Загрузка…/);
    assert.match(html, /Откройте анкету по ссылке из чата с ботом в MAX\./);
    assert.match(html, /Вернуться в чат/);
    assert.match(html, /WebApp\.close\(\)/);
    // Двойное нажатие «Отправить» не отправит ответы дважды.
    assert.match(html, /submitButton\.disabled = true/);
  });

  it('отдаёт анкету по коду события', async () => {
    const response = await fetch(
      `http://127.0.0.1:${handle.port}/app/api/questionnaire?code=abc12`,
    );
    const data = (await response.json()) as { event?: { title?: string } };

    assert.equal(response.status, 200);
    assert.equal(data.event?.title, 'Настолки');
  });

  it('возвращает 404 на неизвестное событие', async () => {
    const response = await fetch(
      `http://127.0.0.1:${handle.port}/app/api/questionnaire?code=ZZZZZ`,
    );
    assert.equal(response.status, 404);
  });

  it('принимает ответы и передаёт их сервису регистрации', async () => {
    savedAnswers.length = 0;
    const response = await fetch(`http://127.0.0.1:${handle.port}/app/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'abc12',
        devUserId: '42',
        name: 'Аня',
        contact: '+79990000000',
        status: 'maybe',
        answers: { f1: 'Снеки' },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(savedAnswers.length, 1);
    assert.equal(savedAnswers[0]?.code, 'ABC12');
    assert.equal(savedAnswers[0]?.userId, 42);
  });

  it('показывает ошибку ограничений, если сервис её вернул', async () => {
    const ticketServer = await startMiniappServer({
      logger: createLogger('error'),
      baseUrl: 'https://example.test',
      port: 0,
      botToken: 'test-bot-token',
      devMode: true,
      takeTicket: async () => null,
      onFieldsSaved: async () => undefined,
      getDraft: async () => null,
      getQuestionnaire: async () => null,
      saveAnswers: async () => ({ ok: false, error: 'Слишком много: максимум 99.', fieldId: 'f-age' }),
    });
    try {
      const response = await fetch(`http://127.0.0.1:${ticketServer.port}/app/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'ABC12', devUserId: '1', answers: {} }),
      });
      const data = (await response.json()) as { error?: string; fieldId?: string };
      assert.equal(response.status, 400);
      assert.match(String(data.error), /максимум 99/);
      assert.equal(data.fieldId, 'f-age');
    } finally {
      await ticketServer.close();
    }
  });
});

describe('Проверка подписи запуска (initData)', () => {
  const token = 'test-bot-token';

  const sign = (params: Record<string, string>): string => {
    const launchParams = Object.entries(params)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
    return createHmac('sha256', secretKey).update(launchParams).digest('hex');
  };

  it('принимает корректную подпись и разбирает пользователя', () => {
    const params = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 777, first_name: 'Аня', last_name: 'Петрова' }),
      query_id: 'q-1',
      start_param: 'ev_ABC12',
    };
    const initData = new URLSearchParams({ ...params, hash: sign(params) }).toString();

    const check = validateInitData(initData, token);
    assert.equal(check.ok, true);
    assert.equal(check.data.user?.id, 777);
    assert.equal(check.data.startParam, 'ev_ABC12');
  });

  it('отклоняет подделку подписи и устаревшие данные', () => {
    const params = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 777, first_name: 'Аня' }),
    };
    const tampered = new URLSearchParams({ ...params, user: JSON.stringify({ id: 999 }), hash: sign(params) });
    assert.equal(validateInitData(tampered.toString(), token).ok, false);

    const stale = {
      auth_date: String(Math.floor(Date.now() / 1000) - 7200),
      user: JSON.stringify({ id: 777, first_name: 'Аня' }),
    };
    const staleData = new URLSearchParams({ ...stale, hash: sign(stale) }).toString();
    const staleCheck = validateInitData(staleData, token);
    assert.equal(staleCheck.ok, false);
    assert.match(String(staleCheck.reason), /устарели/);

    assert.equal(validateInitData('', token).ok, false);
  });
});
