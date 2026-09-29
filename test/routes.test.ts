import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';
import { hoursFromNow } from './support.js';

/**
 * Маршрутизация кнопок: каждая ветка роутера должна на что-то отвечать и не
 * падать. Это «дымовой» тест — он ловит опечатки в payload'ах и потерянные
 * ветки, которые иначе обнаруживаются только руками в живом боте.
 *
 * Полные сценарии лежат в других файлах (flows, shopMoney, registration).
 */
describe('Маршрутизация кнопок: дымовые проверки', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  const event = async (organizerId = 1200) =>
    harness.base.events.create({
      title: 'Вечер настолок',
      description: 'Берём свои игры',
      startsAt: hoursFromNow(48),
      place: 'антикафе Кубик',
      placeCoords: null,
      limit: 6,
      fields: [],
      answerMode: 'auto',
      organizerId,
      organizerName: 'Оля',
    });

  /** Клик по кнопке: бот должен ответить и не пожаловаться на ошибку. */
  const clickOk = async (payload: string, chatId = 1200, userId = 1200): Promise<string> => {
    harness.clearSent();
    await harness.click(payload, { chatId, userId });
    const texts = harness.texts(chatId);
    assert.ok(texts.length > 0, `нет ответа на ${payload}`);
    const failed = texts.filter((text) => /Не получилось выполнить|Не удалось выполнить/i.test(text));
    assert.deepEqual(failed, [], `бот ответил ошибкой на ${payload}: ${failed.join(' | ')}`);
    return texts.join('\n');
  };

  it('меню: помощь, частые вопросы и профиль', async () => {
    for (const payload of ['menu:help', 'menu:faq', 'menu:profile', 'menu:events']) {
      const answer = await clickOk(payload);
      assert.ok(answer.trim().length > 0);
    }
  });

  it('карточка события, состав, ссылка и дополнительная информация', async () => {
    const created = await event();
    const card = await clickOk(`ev:card:${created.code}`);
    assert.match(card, /Вечер настолок/);

    const people = await clickOk(`ev:people:${created.code}`);
    assert.match(people, /Участники|никого/i);

    const link = await clickOk(`ev:link:${created.code}`);
    assert.match(link, /max\.ru|Код события/);

    const info = await clickOk(`ev:info:${created.code}`);
    assert.match(info, /Вечер настолок/);
  });

  it('покупки доступны из карточки сразу', async () => {
    const created = await event();
    harness.clearSent();
    await harness.click(`ev:card:${created.code}`, { chatId: 1200, userId: 1200 });

    const labels = harness.lastButtons(1200).map((button) => button.text);
    assert.ok(
      labels.includes('Добавить список покупок'),
      `в карточке нет входа в покупки: ${labels.join(', ')}`,
    );
    // Расчётов в продукте нет: кнопки и экрана быть не должно.
    assert.ok(
      !labels.some((label) => /расчёт/i.test(label)),
      `осталась кнопка расчётов: ${labels.join(', ')}`,
    );
  });

  it('настройка способа ответа на анкету и возврат', async () => {
    const created = await event();
    const screen = await clickOk(`q:mode:${created.code}`);
    assert.match(screen, /Способ ответа/);

    const applied = await clickOk(`q:set:${created.code}:chat`);
    assert.match(applied, /Вечер настолок/);
    const stored = await harness.base.events.findByCode(created.code);
    assert.equal(stored?.answerMode, 'chat');

    // Кнопка возврата ведёт к карточке события (payload собирает сама карточка).
    const back = await clickOk(`ev:card:${created.code}`);
    assert.match(back, /Вечер настолок/);
  });

  it('редактирование события открывает меню правок', async () => {
    const created = await event();
    const menu = await clickOk(`ev:edit:${created.code}`);
    assert.match(menu, /Что меняем/);

    // Открываем конкретное поле и отменяем: мастер не должен залипнуть,
    // а следующий текст — обрабатываться как шаг редактирования.
    await clickOk(`ev:set:${created.code}:title`);
    harness.clearSent();
    await harness.sendText('/cancel', { chatId: 1200, userId: 1200 });
    assert.match(harness.lastText(1200), /Ассистент организатора|Мои события/);

    const sessions = await harness.base.deps.sessions.findByUser(1200);
    const withDraft = sessions.filter((row) => Boolean((row.value as { draft?: unknown }).draft));
    assert.deepEqual(withDraft, [], 'после отмены черновик остался');

    // Свободный текст после отмены обрабатывается как обычное сообщение.
    harness.clearSent();
    await harness.sendText('привет', { chatId: 1200, userId: 1200 });
    assert.ok(harness.lastText(1200).trim().length > 0);
  });

  it('напоминание участникам по кнопке организатора', async () => {
    const created = await event();
    await harness.base.participants.save({
      event: created,
      userId: 1201,
      name: 'Аня',
      username: null,
      contact: '',
      status: 'going',
      answers: {},
    });

    await clickOk(`ev:remind:${created.code}`);
    const delivered = harness.sent.filter((message) => message.chatId === 1201);
    assert.ok(delivered.length > 0, 'участник не получил напоминание');
  });

  it('закрытие события меняет его состояние', async () => {
    const created = await event();
    await clickOk(`ev:close:${created.code}`);
    const stored = await harness.base.events.findByCode(created.code);
    assert.equal(stored?.status, 'closed');
  });

  it('шаблоны: список, карточка и переименование', async () => {
    const template = await harness.base.templates.createFromFields(1200, 'Мой набор', []);

    const list = await clickOk('menu:templates');
    assert.match(list, /набор|Набор/i);

    const card = await clickOk(`tpl:edit:${template.id}`);
    assert.match(card, /Мой набор/);

    harness.clearSent();
    await harness.click(`tpl:rename:${template.id}`, { chatId: 1200, userId: 1200 });
    await harness.sendText('Новый набор', { chatId: 1200, userId: 1200 });
    const renamed = await harness.base.templates.find(template.id, 1200);
    assert.equal(renamed?.name, 'Новый набор');
  });

  it('частые вопросы: ответ по кнопке и по свободному тексту', async () => {
    const created = await event();
    const answer = await clickOk(`faq:ev:${created.code}:where`, 1200, 1200);
    assert.match(answer, /адрес|Адрес|карт|место/i);

    // Свободный текст в контексте события тоже находит ответ.
    harness.clearSent();
    await harness.sendText(`/start ev_${created.code}`, { chatId: 1300, userId: 1300 });
    await harness.sendText('как добраться до места', { chatId: 1300, userId: 1300 });
    const byText = harness.lastText(1300);
    assert.ok(byText.trim().length > 0);
  });

  it('неизвестный ввод не оставляет пользователя без ответа', async () => {
    harness.clearSent();
    await harness.sendText('абракадабра-без-смысла', { chatId: 1400, userId: 1400 });
    const answer = harness.lastText(1400);
    assert.ok(answer.trim().length > 0, 'бот промолчал на непонятный текст');
    assert.doesNotMatch(answer, /Не получилось выполнить/);
  });

  it('профиль: сохранение контакта для связи', async () => {
    harness.clearSent();
    await harness.click('profile:contact', { chatId: 1500, userId: 1500 });
    await harness.sendText('+7 900 000-11-22', { chatId: 1500, userId: 1500 });
    const withContact = await harness.base.profiles.get(1500);
    assert.equal(withContact?.contact, '+7 900 000-11-22');

    // Контакт переживает показ профиля заново: он сохранён в БД, а не в памяти шага.
    await harness.clearSent();
    await harness.click('menu:profile', { chatId: 1500, userId: 1500 });
    const shown = await harness.base.profiles.get(1500);
    assert.equal(shown?.contact, '+7 900 000-11-22');
    assert.match(harness.lastText(1500), /\+7 900 000-11-22/);
  });

  /**
   * Права: участник не управляет чужим событием, даже если кнопка пришла из
   * старого сообщения. Проверяем и ответ, и то, что состояние не изменилось —
   * иначе проверка «бот что-то ответил» пропускает тихую правку чужого события.
   */
  describe('чужие кнопки организатора', () => {
    const STRANGER = 1600;

    /** Сколько незавершённых черновиков у пользователя: мастер не должен начаться. */
    const draftsOf = async (userId: number): Promise<number> => {
      const sessions = await harness.base.deps.sessions.findByUser(userId);
      return sessions.filter((row) => Boolean((row.value as { draft?: unknown }).draft)).length;
    };

    const withParticipant = async (userId: number) => {
      const created = await event();
      await harness.base.participants.save({
        event: created,
        userId,
        name: 'Аня',
        username: null,
        contact: '',
        status: 'going',
        answers: {},
      });
      return created;
    };

    it('не открывает меню правок и не начинает правку поля', async () => {
      const created = await event();
      harness.clearSent();
      await harness.click(`ev:edit:${created.code}`, { chatId: STRANGER, userId: STRANGER });
      assert.doesNotMatch(harness.lastText(STRANGER), /Что меняем/, 'участник открыл меню правок');

      await harness.click(`ev:set:${created.code}:title`, { chatId: STRANGER, userId: STRANGER });
      assert.equal(await draftsOf(STRANGER), 0, 'у участника появился черновик правки');
    });

    it('не меняет способ ответа на анкету', async () => {
      const created = await event();
      await harness.click(`q:set:${created.code}:chat`, { chatId: STRANGER, userId: STRANGER });
      const stored = await harness.base.events.findByCode(created.code);
      assert.equal(stored?.answerMode, 'auto', 'участник поменял способ ответа');
    });

    it('не показывает состав участников', async () => {
      const created = await event();
      harness.clearSent();
      await harness.click(`ev:people:${created.code}`, { chatId: STRANGER, userId: STRANGER });
      assert.match(harness.lastText(STRANGER), /другой организатор/);
    });

    it('не добавляет позиции в список покупок', async () => {
      const created = await event();
      await harness.click(`shop:add:${created.code}`, { chatId: STRANGER, userId: STRANGER });
      assert.equal(await draftsOf(STRANGER), 0, 'участник получил мастер добавления позиций');

      // И следующий текст не должен обрабатываться как позиции.
      await harness.sendText('Вода', { chatId: STRANGER, userId: STRANGER });
      assert.deepEqual(await harness.base.items.list(created.id), [], 'участник добавил позиции');
    });

    it('не рассылает список покупок и не закрывает событие', async () => {
      const created = await withParticipant(1601);

      harness.clearSent();
      await harness.click(`shop:notify:${created.code}`, { chatId: STRANGER, userId: STRANGER });
      assert.match(harness.lastText(STRANGER), /только организатор/);
      assert.deepEqual(
        harness.sent.filter((message) => message.chatId === 1601),
        [],
        'участник разослал список покупок',
      );

      await harness.click(`ev:close:${created.code}`, { chatId: STRANGER, userId: STRANGER });
      const stored = await harness.base.events.findByCode(created.code);
      assert.equal(stored?.status, 'published', 'участник закрыл событие');
    });

    it('не рассылает напоминание участникам', async () => {
      const created = await withParticipant(1602);

      harness.clearSent();
      await harness.click(`ev:remind:${created.code}`, { chatId: STRANGER, userId: STRANGER });
      assert.match(harness.lastText(STRANGER), /другой организатор/);
      assert.deepEqual(
        harness.sent.filter((message) => message.chatId === 1602),
        [],
        'участник разослал напоминание',
      );
    });

    it('не трогает чужой набор вопросов', async () => {
      const template = await harness.base.templates.createFromFields(1200, 'Мой набор', []);

      await harness.click(`tpl:rename:${template.id}`, { chatId: STRANGER, userId: STRANGER });
      await harness.sendText('Угнал', { chatId: STRANGER, userId: STRANGER });
      const renamed = await harness.base.templates.find(template.id, 1200);
      assert.equal(renamed?.name, 'Мой набор', 'чужой набор переименован');

      await harness.click(`tpl:delok:${template.id}`, { chatId: STRANGER, userId: STRANGER });
      assert.ok(await harness.base.templates.find(template.id, 1200), 'чужой набор удалён');
      assert.equal(await draftsOf(STRANGER), 0, 'у участника появился черновик набора');
    });
  });
});
