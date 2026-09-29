import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { applyMiniappFields, readDraftQuestionnaire } from '../src/bot/handlers/miniappSync.js';
import type { BotSession } from '../src/bot/session.js';
import type { MiniappField, MiniappTicket } from '../src/miniapp/server.js';
import { createBotHarness, type BotHarness } from './botHarness.js';

let harness: BotHarness;

before(async () => {
  harness = await createBotHarness();
});

after(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  harness.clearSent();
});

const field: MiniappField = {
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
};

/** Черновик создания события — минимальный валидный для связки с приложением. */
const eventDraft = (title: string): BotSession['draft'] => ({
  kind: 'create-event',
  step: 'fields',
  data: { title, templateId: null, saveTemplateName: null },
  fields: [],
  editor: null,
});

/** Пропуск конструктора: сессия мастера и чат, куда вернуть обновлённый экран. */
const ticketFor = (sessionKey: string): MiniappTicket => {
  const [userId = 0, chatId = 0] = sessionKey.split(':').map(Number);
  return { userId, chatId, sessionKey, at: Date.now() };
};

describe('Сохранение вопросов из мини-приложения', () => {
  it('кладет вопросы, режим и название набора в черновик события', async () => {
    await harness.click('ev:new');
    await harness.sendText('Поход');
    await harness.sendText('завтра 19:00');
    await harness.sendText('лес');
    await harness.click('draft:place:ok');
    await harness.click('draft:skip');
    await harness.click('draft:skip');
    await harness.click('draft:template:own');
    harness.clearSent();

    await applyMiniappFields(harness.deps, ticketFor('500:500'), [field], 'miniapp', 'Походный набор');

    // В чат ушёл обновлённый экран вопросов.
    assert.match(harness.lastText(), /Возраст/);
    assert.match(harness.lastText(), /мини-приложении/);

    // Черновик обновлён: вопросы, режим и название для шаблона.
    const questionnaires = await readDraftQuestionnaire(harness.deps, ticketFor('500:500'));
    assert.ok(questionnaires);
    assert.equal(questionnaires.fields.length, 1);
    assert.equal(questionnaires.fields[0]?.label, 'Возраст');
    assert.equal(questionnaires.fields[0]?.min, 6);
    assert.equal(questionnaires.answerMode, 'miniapp');
    assert.equal(questionnaires.name, 'Походный набор');
  });

  it('поддерживает набор вопросов, создаваемый из меню', async () => {
    await harness.click('tpl:new');
    await harness.sendText('Мой набор');
    await harness.clearSent();

    await applyMiniappFields(harness.deps, ticketFor('500:500'), [field], 'auto', 'Мой набор');

    const questionnaires = await readDraftQuestionnaire(harness.deps, ticketFor('500:500'));
    assert.ok(questionnaires);
    assert.equal(questionnaires.fields[0]?.label, 'Возраст');
    assert.equal(questionnaires.name, 'Мой набор');

    // В чат уходит экран набора, а не события: у набора нет способа ответа,
    // а его «Сохранить» действительно сохраняет набор.
    assert.match(harness.lastText(), /Набор «Мой набор»/);
    const buttons = harness.lastButtons().map((button) => button.text);
    assert.ok(buttons.includes('Сохранить'), `нет кнопки сохранения: ${buttons.join(', ')}`);
    assert.ok(!buttons.some((text) => /Способ ответа/.test(text)), 'у набора не должно быть способа ответа');

    await harness.click('draft:skip');
    const templates = await harness.templates.custom(500);
    assert.equal(templates.length, 1, 'набор не сохранён из мини-приложения');
    assert.equal(templates[0]?.fields[0]?.label, 'Возраст');
  });

  it('сообщает об ошибке, если активного черновика нет', async () => {
    await assert.rejects(
      () => applyMiniappFields(harness.deps, ticketFor('777:777'), [field], 'auto', ''),
      /Черновик вопросов не найден/,
    );
    assert.equal(await readDraftQuestionnaire(harness.deps, ticketFor('777:777')), null);
  });

  it('не подхватывает чужой черновик, если сессии из пропуска нет', async () => {
    // Черновик у пользователя есть, но не в той сессии, что записана в пропуске.
    // До этого вопросы уезжали в «первый подходящий» черновик пользователя.
    await harness.base.sessionStore.set('500:500', { draft: eventDraft('Первый чат') });
    harness.clearSent();

    await assert.rejects(
      () => applyMiniappFields(harness.deps, ticketFor('500:777'), [field], 'auto', ''),
      /Черновик вопросов не найден/,
    );
    assert.equal(await readDraftQuestionnaire(harness.deps, ticketFor('500:777')), null);

    const untouched = await harness.base.sessionStore.get('500:500');
    assert.equal(
      (untouched?.draft as { fields?: unknown[] })?.fields?.length,
      0,
      'правка ушла в чужой черновик',
    );
  });

  it('правит черновик той сессии, из которой открыт конструктор', async () => {
    // У организатора два чата с незавершёнными мастерами: вопросы из приложения
    // должны попасть строго в тот черновик, чья подпись открыла конструктор.
    await harness.base.sessionStore.set('500:500', { draft: eventDraft('Первый чат') });
    await harness.base.sessionStore.set('500:501', { draft: eventDraft('Второй чат') });
    harness.clearSent();

    await applyMiniappFields(harness.deps, ticketFor('500:501'), [field], 'auto', '');

    const first = await harness.base.sessionStore.get('500:500');
    const second = await harness.base.sessionStore.get('500:501');
    assert.equal((first?.draft as { fields?: unknown[] })?.fields?.length, 0, 'правка ушла в чужой чат');
    assert.equal((second?.draft as { fields?: unknown[] })?.fields?.length, 1);

    // Экран обновления уходит в тот же чат (501), а не в 500.
    assert.match(harness.lastText(501), /Возраст/);
    assert.deepEqual(harness.texts(500), []);

    // Конструктор по той же подписи видит вопросы именно этой сессии.
    const questionnaire = await readDraftQuestionnaire(harness.deps, ticketFor('500:501'));
    assert.equal(questionnaire?.fields[0]?.label, 'Возраст');
    const other = await readDraftQuestionnaire(harness.deps, ticketFor('500:500'));
    assert.deepEqual(other?.fields, []);
  });
});
