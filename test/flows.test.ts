import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

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

/** Ни один шаг не должен заканчиваться сообщением об ошибке. */
const noErrors = (chatId = 500): void => {
  const failed = harness
    .texts(chatId)
    .filter((text) => /Не получилось выполнить|Не удалось выполнить|не получилось/i.test(text));
  assert.deepEqual(failed, [], `бот ответил ошибкой: ${failed.join(' | ')}`);
};

describe('Мастера: создание вопросов из главного меню', () => {
  it('создаёт набор вопросов из /templates и сохраняет его', async () => {
    await harness.sendText('/templates');
    noErrors();

    const buttons = harness.lastButtons();
    const createButton = buttons.find((button) => button.payload === 'tpl:new');
    assert.ok(createButton, `нет кнопки создания набора, есть: ${buttons.map((b) => b.text).join(', ')}`);

    await harness.click('tpl:new');
    noErrors();
    assert.match(harness.lastText(), /название|Название/i);

    await harness.sendText('Мой набор');
    noErrors();
    const afterName = harness.lastText();
    assert.match(afterName, /Вопросы|вопрос/i);

    // Добавляем вопрос через мастер: текст → тип → обязательность.
    await harness.click('draft:field:add');
    noErrors();
    await harness.sendText('Что принесёте с собой?');
    noErrors();
    const typeScreen = harness.lastButtons();
    assert.ok(typeScreen.some((button) => button.payload === 'draft:fieldtype:text'), 'нет кнопок типа вопроса');
    await harness.click('draft:fieldtype:text');
    noErrors();
    // У текстового вопроса спрашиваем максимальную длину — пропускаем.
    await harness.click('draft:editorskip');
    noErrors();
    await harness.click('draft:fieldreq:yes');
    noErrors();

    const fieldsScreen = harness.lastText();
    assert.match(fieldsScreen, /Что принесёте с собой\?/, 'добавленный вопрос не появился в списке');

    // Сохраняем набор.
    await harness.click('draft:skip');
    noErrors();
    assert.match(harness.lastText(), /Мой набор/);

    const templates = await harness.templates.custom(500);
    assert.equal(templates.length, 1, 'набор не сохранён');
    assert.equal(templates[0]?.fields.length, 1);
    assert.equal(templates[0]?.fields[0]?.label, 'Что принесёте с собой?');
  });
});

describe('Мастера: вопросы в создании события', () => {
  it('проходит мастер до вопросов, добавляет свой вопрос и публикует событие', async () => {
    await harness.click('ev:new');
    noErrors();

    await harness.sendText('Настолки в пятницу');
    await harness.sendText('завтра 19:00');
    noErrors();
    await harness.sendText('антикафе Кубик, ул. Ленина 5');
    noErrors();

    // Экран подтверждения адреса: адрес — ссылка на карту.
    assert.match(harness.lastText(), /Проверьте адрес/);
    await harness.click('draft:place:ok');
    noErrors();

    await harness.click('draft:skip'); // без описания
    await harness.click('draft:skip'); // без лимита
    noErrors();

    // Шаг 6: свои вопросы (экран вопросов с кнопками).
    await harness.click('draft:template:own');
    noErrors();
    assert.match(harness.lastText(), /Вопросы участникам/);

    await harness.click('draft:field:add');
    noErrors();
    await harness.sendText('Что принесёте к столу?');
    await harness.click('draft:fieldtype:choice');
    noErrors();
    await harness.sendText('Снеки, Напитки');
    noErrors();
    await harness.click('draft:fieldmulti:yes');
    noErrors();
    // Границы выбора можно пропустить.
    await harness.click('draft:editorskip');
    await harness.click('draft:editorskip');
    noErrors();
    await harness.click('draft:fieldreq:yes');
    noErrors();
    assert.match(harness.lastText(), /Что принесёте к столу\?/);

    await harness.click('draft:skip'); // дальше — к сохранению шаблона
    noErrors();
    await harness.click('draft:skip'); // шаблон не сохраняем
    noErrors();
    assert.match(harness.lastText(), /Проверьте событие/);

    await harness.click('draft:publish');
    noErrors();
    // Сначала уходит карточка события, затем сообщение со ссылкой-приглашением.
    assert.ok(
      harness.texts().some((textValue) => textValue.includes('Настолки в пятницу')),
      'карточка события не отправлена',
    );
    assert.ok(
      harness.texts().some((textValue) => textValue.includes('start=ev_')),
      'ссылка-приглашение не отправлена',
    );

    const events = await harness.events.listByOrganizer(500);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.fields.length, 1);
    assert.equal(events[0]?.fields[0]?.type, 'choice');
    assert.deepEqual(events[0]?.fields[0]?.options, ['Снеки', 'Напитки']);
    assert.equal(events[0]?.fields[0]?.multiple, true);
  });

  it('переключает способ ответа из экрана вопросов и сохраняет его в событии', async () => {
    await harness.click('ev:new');
    await harness.sendText('Поход с анкетой');
    await harness.sendText('завтра 19:00');
    await harness.sendText('лес');
    await harness.click('draft:place:ok');
    await harness.click('draft:skip');
    await harness.click('draft:skip');
    await harness.click('draft:template:own');
    noErrors();

    // Кнопка «Способ ответа» раньше молча ничего не делала.
    await harness.click('q:mode:draft');
    noErrors();
    assert.match(harness.lastText(), /Способ ответа на анкету/);
    assert.match(harness.lastText(), /Вес вопросов/);

    // Возврат не должен проматывать мастер вперёд.
    await harness.click('q:back:draft');
    noErrors();
    assert.match(harness.lastText(), /Вопросы участникам/);

    await harness.click('q:set:draft:chat');
    noErrors();
    assert.match(harness.lastText(), /Отвечают в чате/);

    await harness.click('draft:skip'); // дальше — к сохранению шаблона
    await harness.click('draft:skip'); // шаблон не сохраняем
    noErrors();
    assert.match(harness.lastText(), /Проверьте событие/);

    await harness.click('draft:publish');
    noErrors();

    const events = await harness.events.listByOrganizer(500);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.answerMode, 'chat', 'выбранный способ ответа не сохранился');
  });

  it('редактирует набор вопросов из /templates: добавить и удалить вопрос', async () => {
    const template = await harness.templates.createFromFields(500, 'Набор', [
      {
        id: 'f1',
        label: 'Первый вопрос',
        type: 'text',
        options: [],
        multiple: false,
        minSelected: null,
        maxSelected: null,
        min: null,
        max: null,
        maxLength: null,
        required: true,
      },
    ]);

    await harness.click(`tpl:use:${template.id}`);
    noErrors();
    await harness.click(`tpl:edit:${template.id}`);
    noErrors();
    assert.match(harness.lastText(), /Первый вопрос/);

    // Добавляем вопрос — раньше этот шаг молча ничего не делал.
    await harness.click('draft:field:add');
    noErrors();
    await harness.sendText('Второй вопрос');
    noErrors();
    await harness.click('draft:fieldtype:yesno');
    noErrors();
    await harness.click('draft:fieldreq:no');
    noErrors();
    assert.match(harness.lastText(), /Второй вопрос/, 'вопрос не добавился в шаблон');

    // Удаляем первый вопрос.
    await harness.click('draft:fieldremove:0');
    noErrors();
    assert.doesNotMatch(harness.lastText(), /Первый вопрос/);

    await harness.click('draft:skip');
    noErrors();

    const updated = await harness.templates.custom(500);
    assert.equal(updated[0]?.fields.length, 1);
    assert.equal(updated[0]?.fields[0]?.label, 'Второй вопрос');
    assert.equal(updated[0]?.fields[0]?.required, false);
  });
});

describe('Защита от двойных нажатий', () => {
  it('двойной клик по «Дальше» не прогоняет два шага', async () => {
    await harness.click('ev:new');
    await harness.sendText('Событие');
    await harness.sendText('завтра 19:00');
    await harness.sendText('адрес');
    await harness.click('draft:place:ok');
    await harness.click('draft:skip');
    noErrors();

    harness.clearSent();
    // Пользователь дважды быстро нажал «Без ограничения» в одном сообщении.
    const mid = `bot-mid-limit`;
    // Оба нажатия подряд, как при реальном двойном тапе.
    await harness.click('draft:skip', { mid, rapid: true });
    await harness.click('draft:skip', { mid, rapid: true });

    const texts = harness.texts();
    assert.equal(texts.length, 1, `на один шаг пришло ${texts.length} сообщения: ${texts.join(' | ')}`);
    assert.match(texts[0] ?? '', /Шаг 6 из 6|Вопросы участникам/);
  });
});
