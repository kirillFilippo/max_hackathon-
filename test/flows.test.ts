import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { EventField } from '../src/domain/types.js';
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
    // Внутренний «вес» анкеты организатору не показываем.
    assert.doesNotMatch(harness.lastText(), /вес|порог/i);

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

describe('Ссылка-приглашение не дублирует карточку', () => {  it('отвечает одним сообщением, когда MAX присылает и bot_started, и /start', async () => {
    const event = await harness.events.create({
      title: 'Встреча',
      description: '',
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      place: 'кафе на Ленина',
      placeCoords: null,
      limit: null,
      fields: [],
      answerMode: 'auto',
      organizerId: 500,
      organizerName: 'Тестовый организатор',
    });

    // MAX на переход по ссылке присылает оба обновления — приглашение одно.
    await harness.start(`ev_${event.code}`, { chatId: 700, userId: 700 });
    assert.equal(harness.texts(700).length, 1, `пришло ${harness.texts(700).length} сообщения`);
    assert.match(harness.lastText(700), /Приглашение на событие/);
    await harness.sendText(`/start ev_${event.code}`, { chatId: 700, userId: 700 });
    assert.equal(
      harness.texts(700).length,
      1,
      `повторный вход продублировал приглашение: ${harness.texts(700).length} сообщения`,
    );

    // Обратный порядок тоже не должен дублировать ответ.
    await harness.sendText(`/start ev_${event.code}`, { chatId: 701, userId: 701 });
    await harness.start(`ev_${event.code}`, { chatId: 701, userId: 701 });
    assert.equal(harness.texts(701).length, 1, `пришло ${harness.texts(701).length} сообщения`);

    // Мастер регистрации начинается по кнопке «Записаться», а не сам по себе.
    await harness.click(`reg:begin:${event.code}`, { chatId: 700, userId: 700 });
    noErrors(700);
    assert.equal(harness.texts(700).length, 2, 'мастер не начался по кнопке');
    assert.match(harness.lastText(700), /Как вас записать/);

    noErrors(701);
  });
});

describe('Вопросы: выбор готового набора и кнопки экрана', () => {
  const templateField: EventField = {
    id: 'f1',
    label: 'Что взять с собой?',
    type: 'text',
    options: [],
    multiple: false,
    minSelected: null,
    maxSelected: null,
    min: null,
    max: null,
    maxLength: null,
    required: true,
  };

  /** Доводит мастер до экрана вопросов: свой набор или выбранный шаблон. */
  const gotoFields = async (templateId?: string): Promise<void> => {
    await harness.click('ev:new');
    await harness.sendText('Поход');
    await harness.sendText('завтра 19:00');
    await harness.sendText('лес');
    await harness.click('draft:place:ok');
    await harness.click('draft:skip');
    await harness.click('draft:skip');
    await harness.click(templateId ? `draft:template:${templateId}` : 'draft:template:own');
    noErrors();
  };

  it('позволяет добавлять вопросы по одному сколько нужно', async () => {
    await gotoFields();

    // Два вопроса подряд проходят одни и те же шаги: текст → тип → длина → обязательность.
    for (const label of ['Первый вопрос', 'Второй вопрос']) {
      await harness.click('draft:field:add');
      await harness.sendText(label);
      await harness.click('draft:fieldtype:text');
      await harness.click('draft:editorskip');
      await harness.click('draft:fieldreq:yes');
      noErrors();
    }

    const list = harness.lastText();
    assert.match(list, /1\. Первый вопрос/);
    assert.match(list, /2\. Второй вопрос/);
  });

  it('не блокирует одинаковые шаги, когда текст вопросов совпадает', async () => {
    await gotoFields();

    // Одинаковые подписи дают одинаковые экраны редактора — повтор шага должен работать.
    for (let index = 0; index < 2; index += 1) {
      await harness.click('draft:field:add');
      await harness.sendText('Один и тот же вопрос');
      await harness.click('draft:fieldtype:yesno');
      await harness.click('draft:fieldreq:yes');
      noErrors();
    }

    assert.match(harness.lastText(), /2\. Один и тот же вопрос/);
  });

  it('позволяет удалить несколько вопросов подряд', async () => {
    await gotoFields();

    for (const label of ['Первый', 'Второй']) {
      await harness.click('draft:field:add');
      await harness.sendText(label);
      await harness.click('draft:fieldtype:yesno');
      await harness.click('draft:fieldreq:yes');
      noErrors();
    }

    // Удаляем первый, затем — снова первый (бывший второй).
    await harness.click('draft:fieldremove:0');
    noErrors();
    assert.doesNotMatch(harness.lastText(), /1\. Первый/);
    await harness.click('draft:fieldremove:0');
    noErrors();
    assert.match(harness.lastText(), /Пока вопросов нет/);
  });

  it('позволяет удалить вопрос и сразу добавить новый', async () => {
    await gotoFields();

    await harness.click('draft:field:add');
    await harness.sendText('Черновик вопроса');
    await harness.click('draft:fieldtype:yesno');
    await harness.click('draft:fieldreq:yes');
    noErrors();

    // Возвращаемся к пустому списку и снова жмём «Добавить вопрос»:
    // экран тот же, нажатие осознанное — оно не должно потеряться.
    await harness.click('draft:fieldremove:0');
    noErrors();
    assert.match(harness.lastText(), /Пока вопросов нет/);

    await harness.click('draft:field:add');
    noErrors();
    assert.match(harness.lastText(), /Отправьте текст вопроса/);
  });

  it('не предлагает сохранять набор, если выбранный шаблон не меняли', async () => {
    const template = await harness.templates.createFromFields(500, 'Готовый набор', [templateField]);
    await gotoFields(template.id);
    assert.match(harness.lastText(), /Что взять с собой\?/);

    const buttons = harness.lastButtons().map((button) => button.text);
    assert.ok(buttons.includes('Добавить вопрос'), `нет кнопки добавления: ${buttons.join(', ')}`);
    assert.ok(buttons.some((text) => text.startsWith('Удалить:')), 'нет кнопки удаления вопроса');
    assert.ok(!buttons.some((text) => text.startsWith('Взять:')), 'подсказки-заготовки больше не нужны');

    await harness.click('draft:skip');
    noErrors();
    assert.match(harness.lastText(), /Проверьте событие/);
    assert.doesNotMatch(harness.lastText(), /шаблон/i);
  });

  it('предлагает сохранить набор, если вопросы изменили', async () => {
    const template = await harness.templates.createFromFields(500, 'Готовый набор', [templateField]);
    await gotoFields(template.id);

    await harness.click('draft:field:add');
    await harness.sendText('Во сколько придёте?');
    await harness.click('draft:fieldtype:text');
    await harness.click('draft:editorskip');
    await harness.click('draft:fieldreq:yes');
    noErrors();

    await harness.click('draft:skip');
    noErrors();
    assert.match(harness.lastText(), /Сохранить/);
  });

  it('открывает конструктор ссылкой мини-приложения и выдаёт подпись', async () => {
    const tickets: string[] = [];
    harness.deps.miniapp = {
      buildUrl: (ticket: string) => `https://example.test/app/questions?t=${ticket}`,
      registerTicket: async (ticket: string) => { tickets.push(ticket); },
      takeTicket: async () => null,
    };
    try {
      await gotoFields();
      await harness.click('app:questions:draft');
      noErrors();

      const open = harness.lastButtons().find((button) => button.text === 'Открыть конструктор');
      assert.ok(open, 'нет кнопки открытия конструктора');
      assert.match(
        open.url,
        /^https:\/\/max\.ru\/DosugTestBot\?startapp=tpl_[0-9a-f]{24}$/,
        `конструктор открывается не ссылкой мини-приложения: ${open.url}`,
      );
      assert.equal(tickets.length, 1, 'подпись мастера не выдана');

      // «Вернуться к вопросам» — возврат к списку, а не «дальше» по мастеру
      // (раньше эта кнопка несла draft:skip и уводила к подтверждению события).
      const back = harness.lastButtons().find((button) => button.text === 'Вернуться к вопросам');
      assert.ok(back, 'нет кнопки возврата к вопросам');
      assert.equal(back.payload, 'q:back:draft');

      await harness.click(back.payload);
      noErrors();
      assert.match(harness.lastText(), /Вопросы участникам/);
      assert.doesNotMatch(
        harness.texts().join('\n'),
        /Проверьте событие|Сохранить набор/,
        'возврат из конструктора проматывает мастер вперёд',
      );
    } finally {
      harness.deps.miniapp = null;
    }
  });

  it('устаревшая кнопка вопросов отвечает, а не молчит', async () => {
    // Так бывает, когда мастер уже закрыт, а в чате осталось старое сообщение:
    // кнопка со scope «draft» доходит до общего роутера. Молчание выглядит
    // как поломка бота, поэтому должен быть ответ и выход.
    await harness.sendText('привет');
    harness.clearSent();
    await harness.click('q:mode:draft');

    const answer = harness.lastText();
    assert.ok(answer.trim().length > 0, 'бот промолчал на устаревшую кнопку');
    assert.doesNotMatch(answer, /Не получилось выполнить/);
    assert.match(answer, /устарел|не активен/);
    assert.ok(
      harness.lastButtons().some((button) => /К событиям/.test(button.text)),
      'нет кнопки выхода из устаревшего экрана',
    );
  });
});
