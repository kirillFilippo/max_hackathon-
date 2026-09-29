import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';
import { hoursFromNow } from './support.js';

/**
 * Редактирование опубликованного события: единственный мастер, который до сих
 * пор не проходил через бота целиком. Здесь важно не только само изменение, но и
 * рассылка участникам: «что именно изменилось» и новая точка на карте.
 */
describe('Редактирование события', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  const setup = async () => {
    const event = await harness.base.events.create({
      title: 'Настолки',
      description: 'Берём свои игры',
      startsAt: hoursFromNow(72),
      place: 'антикафе Кубик, ул. Ленина 5',
      placeCoords: null,
      limit: 6,
      fields: [],
      answerMode: 'auto',
      organizerId: 2000,
      organizerName: 'Оля',
    });
    const participant = await harness.base.participants.save({
      event,
      userId: 2001,
      name: 'Аня',
      username: null,
      contact: '',
      status: 'going',
      answers: {},
    });
    assert.equal(participant.ok, true);
    return event;
  };

  it('меняет дату и рассылает участникам, что изменилось', async () => {
    harness.clearSent();
    const event = await setup();

    await harness.click(`ev:set:${event.code}:startsAt`, { chatId: 2000, userId: 2000 });
    assert.match(harness.lastText(2000), /Когда|дата|дату/i);

    await harness.sendText('25.12 20:30', { chatId: 2000, userId: 2000 });

    const updated = await harness.base.events.findByCode(event.code);
    assert.notEqual(updated?.startsAt, event.startsAt, 'дата не изменилась');
    assert.match(harness.lastText(2000), /Изменения сохранены/);

    // Участник получил уведомление с описанием изменения.
    const notification = harness.texts(2001).join('\n');
    assert.match(notification, /Организатор изменил событие/);
    assert.match(notification, /25 декабря|20:30|Когда/i);
  });

  it('меняет название и лимит мест', async () => {
    harness.clearSent();
    const event = await setup();

    await harness.click(`ev:set:${event.code}:title`, { chatId: 2000, userId: 2000 });
    await harness.sendText('Настолки у Оли', { chatId: 2000, userId: 2000 });
    assert.equal((await harness.base.events.findByCode(event.code))?.title, 'Настолки у Оли');

    await harness.click(`ev:set:${event.code}:limit`, { chatId: 2000, userId: 2000 });
    await harness.sendText('4', { chatId: 2000, userId: 2000 });
    assert.equal((await harness.base.events.findByCode(event.code))?.limit, 4);
  });

  it('новый адрес проходит экран подтверждения и попадает в карту', async () => {
    harness.clearSent();
    const event = await setup();

    await harness.click(`ev:set:${event.code}:place`, { chatId: 2000, userId: 2000 });
    await harness.sendText('парк Горького, вход у фонтана', { chatId: 2000, userId: 2000 });

    // Без явного подтверждения адрес не меняется.
    const beforeConfirm = await harness.base.events.findByCode(event.code);
    assert.equal(beforeConfirm?.place, 'антикафе Кубик, ул. Ленина 5');
    assert.match(harness.lastText(2000), /Адрес верный|Проверьте адрес/);

    await harness.click('draft:place:ok', { chatId: 2000, userId: 2000 });
    const updated = await harness.base.events.findByCode(event.code);
    assert.equal(updated?.place, 'парк Горького, вход у фонтана');

    // Участнику ушло изменение с ссылкой на карту.
    const notification = harness.texts(2001).join('\n');
    assert.match(notification, /yandex\.ru\/maps|Место|Адрес/);
  });

  it('«Отмена» в шаге правки не меняет событие', async () => {
    harness.clearSent();
    const event = await setup();

    await harness.click(`ev:set:${event.code}:description`, { chatId: 2000, userId: 2000 });
    harness.clearSent();
    await harness.sendText('/cancel', { chatId: 2000, userId: 2000 });

    const stored = await harness.base.events.findByCode(event.code);
    assert.equal(stored?.description, 'Берём свои игры');

    // Черновик мастера снят: следующий текст обрабатывается как обычное сообщение.
    const sessions = await harness.base.deps.sessions.findByUser(2000);
    const drafts = sessions.filter((row) => Boolean((row.value as { draft?: unknown }).draft));
    assert.deepEqual(drafts, [], 'черновик правки остался после отмены');
  });

  it('чужие события редактировать нельзя', async () => {
    harness.clearSent();
    const event = await setup();

    // Участник открывает карточку правок: меню правок ему не показывают.
    await harness.click(`ev:edit:${event.code}`, { chatId: 2001, userId: 2001 });
    assert.doesNotMatch(harness.lastText(2001), /Что меняем/);

    // И шаг правки не открывается: черновик чужому пользователю не создаётся.
    await harness.clearSent();
    await harness.click(`ev:set:${event.code}:title`, { chatId: 2001, userId: 2001 });
    const answer = harness.lastText(2001);
    assert.ok(answer.trim().length > 0);

    const sessions = await harness.base.deps.sessions.findByUser(2001);
    const drafts = sessions.filter((row) => Boolean((row.value as { draft?: unknown }).draft));
    assert.deepEqual(drafts, [], 'черновик правки создан для не-организатора');

    // Даже если участник продолжит как мастер правки, событие не изменится.
    await harness.sendText('Взломанное название', { chatId: 2001, userId: 2001 });
    assert.equal((await harness.base.events.findByCode(event.code))?.title, 'Настолки');
  });
});
