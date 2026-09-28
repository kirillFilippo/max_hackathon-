import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';
import { hoursFromNow, register } from './support.js';

/**
 * Список покупок глазами участника: бронирование по кнопке и номерами текстом,
 * имена в списке совпадают с именами в заявках.
 */
describe('Список покупок: бронирование', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  const setup = async (organizerId: number) => {
    const event = await harness.base.events.create({
      title: 'Поход',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'лес',
      placeCoords: null,
      limit: null,
      fields: [],
      answerMode: 'auto',
      organizerId,
      organizerName: 'Оля',
    });
    await harness.base.items.add(event.id, ['Продукты', 'Вода', 'Уголь', 'Мангал']);
    return event;
  };

  const chats = async (eventId: string, ...people: Array<[number, string]>) => {
    for (const [userId, name] of people) await register(harness.base, eventId, userId, name, 'going');
  };

  it('номера позиций работают текстом сразу после открытия списка', async () => {
    harness.clearSent();
    const event = await setup(1400);
    await chats(event.id, [1401, 'Аня']);
    const chat = { chatId: 1401, userId: 1401 };

    await harness.click(`shop:show:${event.code}`, chat);
    // Подсказка обещает этот ввод — значит он должен работать без лишних кнопок.
    assert.match(harness.lastText(1401), /отправьте номера через пробел/);

    await harness.sendText('2 3', chat);
    const screen = harness.lastText(1401);
    assert.match(screen, /Забронировано за вами/);
    assert.match(screen, /Вода/);
    assert.match(screen, /Уголь/);

    const items = await harness.base.items.list(event.id);
    assert.deepEqual(
      items.filter((item) => item.reservation !== null).map((item) => item.title),
      ['Вода', 'Уголь'],
    );
  });

  it('повторный номер сообщает, что позиция уже ваша, и не дублирует бронь', async () => {
    harness.clearSent();
    const event = await setup(1410);
    await chats(event.id, [1411, 'Боря']);
    const chat = { chatId: 1411, userId: 1411 };

    await harness.click(`shop:show:${event.code}`, chat);
    await harness.sendText('2', chat);
    harness.clearSent();
    await harness.sendText('2', chat);

    assert.match(harness.lastText(1411), /Уже были за вами/);
    const items = await harness.base.items.list(event.id);
    assert.equal(items.filter((item) => item.reservation !== null).length, 1);
  });

  it('в списке видно имя из заявки, а не имя профиля MAX', async () => {
    harness.clearSent();
    const event = await setup(1420);
    await chats(event.id, [1421, 'Вика']);
    const chat = { chatId: 1421, userId: 1421 };

    await harness.click(`shop:show:${event.code}`, chat);
    const takeButton = harness.lastButtons(1421).find((button) => button.text.includes('взять'))!;
    await harness.click(takeButton.payload, chat);

    const screen = harness.lastText(1421);
    assert.match(screen, /Вика/, 'в брони должно быть имя из заявки');
    assert.doesNotMatch(screen, /Тестовый организатор/);
    assert.match(screen, /\(вы\)/, 'своя позиция помечается «(вы)»');
  });

  it('занятая другим участником позиция называет его имя и не перезаписывается', async () => {
    harness.clearSent();
    const event = await setup(1430);
    await chats(event.id, [1431, 'Аня'], [1432, 'Гриша']);

    await harness.click(`shop:show:${event.code}`, { chatId: 1431, userId: 1431 });
    await harness.sendText('1', { chatId: 1431, userId: 1431 });

    harness.clearSent();
    await harness.click(`shop:show:${event.code}`, { chatId: 1432, userId: 1432 });
    await harness.sendText('1 2', { chatId: 1432, userId: 1432 });

    const screen = harness.lastText(1432);
    assert.match(screen, /уже заняты/);
    assert.match(screen, /Продукты — Аня/);
    assert.match(screen, /Забронировано за вами:[\s\S]*Вода/);

    const items = await harness.base.items.list(event.id);
    assert.equal(items.find((item) => item.title === 'Продукты')?.reservation?.userName, 'Аня');
  });

  it('номера вне списка не бронируют ничего и не пугают пользователя', async () => {
    harness.clearSent();
    const event = await setup(1440);
    await chats(event.id, [1441, 'Дина']);
    const chat = { chatId: 1441, userId: 1441 };

    await harness.click(`shop:show:${event.code}`, chat);
    await harness.sendText('9', chat);

    assert.match(harness.lastText(1441), /Номеров нет в списке/);
    const items = await harness.base.items.list(event.id);
    assert.equal(items.filter((item) => item.reservation !== null).length, 0);
  });

  it('числа в обычном сообщении без списка покупок брони не создают', async () => {
    harness.clearSent();
    const event = await setup(1450);
    await chats(event.id, [1451, 'Егор']);
    const chat = { chatId: 1451, userId: 1451 };

    // Список не открывали: «1» — это не бронирование, а непонятный ввод.
    await harness.sendText('1', chat);
    assert.match(harness.lastText(1451), /Не понял сообщение/);
    const items = await harness.base.items.list(event.id);
    assert.equal(items.filter((item) => item.reservation !== null).length, 0);
  });
});
