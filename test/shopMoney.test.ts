import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';
import { hoursFromNow } from './support.js';

/**
 * Магазин и расчёты: организатор добавляет позиции, участники их разбирают,
 * вводят фактические суммы, а бот считает, кто кому должен, и передаёт реквизиты.
 *
 * Эти маршруты раньше не проходили целиком через бота: сервисы были покрыты,
 * а нажатия кнопок (`shop:*`, `item:*`, `money:*`, `tr:*`) — нет, поэтому
 * опечатка в payload'е ломала бы половину демонстрации молча.
 */
describe('Покупки и расчёты целиком через бота', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  const createEvent = async () =>
    harness.base.events.create({
      title: 'Поход',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'лес',
      placeCoords: null,
      limit: null,
      fields: [],
      answerMode: 'auto',
      organizerId: 900,
      organizerName: 'Оля',
    });

  const join = async (event: Awaited<ReturnType<typeof createEvent>>, userId: number, name: string) => {
    const result = await harness.base.participants.save({
      event,
      userId,
      name,
      username: null,
      contact: '',
      status: 'going',
      answers: {},
    });
    assert.equal(result.ok, true);
    return result;
  };

  it('организатор добавляет позиции, участник берёт одну и видит отказ по занятой', async () => {
    harness.clearSent();
    const event = await createEvent();
    await join(event, 901, 'Аня');
    await join(event, 902, 'Боря');

    // Организатор вводит список: каждая строка (или часть через «;») — позиция.
    await harness.click(`shop:add:${event.code}`, { chatId: 900, userId: 900 });
    await harness.sendText('1. Продукты\n2. Вода', { chatId: 900, userId: 900 });

    const items = await harness.base.items.list(event.id);
    assert.equal(items.length, 2, 'позиции не добавились');
    assert.match(harness.lastText(900), /Список покупок/);

    // Аня берёт первую позицию.
    await harness.click(`item:take:${event.code}:${items[0]!.id}`, { chatId: 901, userId: 901 });
    const afterTake = await harness.base.items.list(event.id);
    assert.equal(afterTake[0]?.reservation?.userId, 901);

    // Боря пробует взять ту же — бот объясняет, что она занята, и не отдаёт бронь.
    // Имя в тексте берётся из профиля MAX (в харнессе он общий для всех).
    await harness.click(`item:take:${event.code}:${items[0]!.id}`, { chatId: 902, userId: 902 });
    assert.match(harness.lastText(902), /уже заняты/);
    const stillTaken = await harness.base.items.list(event.id);
    assert.equal(stillTaken[0]?.reservation?.userId, 901, 'бронь перешла к другому');

    // «Мои позиции» показывает позицию Ани.
    await harness.click(`shop:mine:${event.code}`, { chatId: 901, userId: 901 });
    assert.match(harness.lastText(901), /Продукты/);
  });

  it('участник освобождает позицию, и её может взять другой', async () => {
    harness.clearSent();
    const event = await createEvent();
    await join(event, 903, 'Вика');
    await join(event, 904, 'Гриша');
    const items = await harness.base.items.add(event.id, ['Настолки']);

    await harness.click(`item:take:${event.code}:${items[0]!.id}`, { chatId: 903, userId: 903 });
    await harness.click(`item:release:${event.code}:${items[0]!.id}`, { chatId: 903, userId: 903 });
    let fresh = await harness.base.items.list(event.id);
    assert.equal(fresh[0]?.reservation, null, 'бронь не снялась');

    await harness.click(`item:take:${event.code}:${items[0]!.id}`, { chatId: 904, userId: 904 });
    fresh = await harness.base.items.list(event.id);
    assert.equal(fresh[0]?.reservation?.userId, 904);
  });

  it('участник вводит фактическую сумму, бот показывает общие траты', async () => {
    harness.clearSent();
    const event = await createEvent();
    await join(event, 905, 'Даша');
    await join(event, 906, 'Егор');
    const items = await harness.base.items.add(event.id, ['Продукты']);

    await harness.click(`item:take:${event.code}:${items[0]!.id}`, { chatId: 905, userId: 905 });
    await harness.click(`item:price:${event.code}:${items[0]!.id}`, { chatId: 905, userId: 905 });
    assert.match(harness.lastText(905), /сумм/i);

    await harness.sendText('1200,50', { chatId: 905, userId: 905 });
    const fresh = await harness.base.items.list(event.id);
    assert.equal(fresh[0]?.reservation?.paidKopecks, 120_050);
    // Сумма показывается в человеческом формате, а не «1200.5 ₽».
    assert.match(harness.texts(905).join('\n'), /1 200,50 ₽/);
  });

  it('расчёты: запросы, реквизиты, отметки о переводе и получении', async () => {
    harness.clearSent();
    const event = await createEvent();
    await join(event, 907, 'Женя');
    await join(event, 908, 'Зина');
    const items = await harness.base.items.add(event.id, ['Продукты']);

    // Женя покупает на 1000 ₽, значит Зина должна ей 500 ₽.
    await harness.base.items.reserveItem(event, items[0]!.id, 907, 'Женя');
    await harness.base.items.setPaidAmount(items[0]!.id, 907, 100_000);

    await harness.click(`money:show:${event.code}`, { chatId: 900, userId: 900 });
    assert.match(harness.lastText(900), /Расчёты/);

    await harness.click(`money:request:${event.code}`, { chatId: 900, userId: 900 });
    const requests = await harness.base.settlements.listByEvent(event.id);
    assert.equal(requests.length, 1, 'запрос на перевод не создан');
    const request = requests[0]!;
    assert.equal(request.fromUserId, 908);
    assert.equal(request.toUserId, 907);
    assert.equal(request.amountKopecks, 50_000);

    // Повторное нажатие не должно слать должнику вторую карточку.
    const beforeRepeat = harness.sent.length;
    await harness.click(`money:request:${event.code}`, { chatId: 900, userId: 900 });
    const debtorCards = harness.sent
      .slice(beforeRepeat)
      .filter((message) => message.chatId === 908);
    assert.equal(debtorCards.length, 0, 'должнику отправлена повторная карточка');

    // Должник отправляет реквизиты, получатель их видит.
    harness.clearSent();
    await harness.click(`tr:details:${request.id}`, { chatId: 908, userId: 908 });
    await harness.sendText('Тинькофф', { chatId: 908, userId: 908 });
    await harness.sendText('+7 900 111-22-33', { chatId: 908, userId: 908 });

    const withDetails = await harness.base.settlements.find(request.id);
    assert.equal(withDetails?.status, 'details_sent');
    assert.match(harness.texts(907).join('\n'), /Тинькофф|\+7 900 111-22-33/);

    // Должник отметил перевод, получатель подтвердил получение — расчёт закрыт.
    await harness.click(`tr:paid:${request.id}`, { chatId: 908, userId: 908 });
    await harness.click(`tr:received:${request.id}`, { chatId: 907, userId: 907 });
    const closed = await harness.base.settlements.find(request.id);
    assert.equal(closed?.status, 'closed');
  });

  it('«отдам при встрече» закрывает долг без реквизитов', async () => {
    harness.clearSent();
    const event = await createEvent();
    await join(event, 909, 'Игорь');
    await join(event, 910, 'Клава');
    const items = await harness.base.items.add(event.id, ['Вода']);
    await harness.base.items.reserveItem(event, items[0]!.id, 909, 'Игорь');
    await harness.base.items.setPaidAmount(items[0]!.id, 909, 60_000);
    await harness.click(`money:request:${event.code}`, { chatId: 900, userId: 900 });
    const request = (await harness.base.settlements.listByEvent(event.id))[0]!;

    await harness.click(`tr:person:${request.id}`, { chatId: 910, userId: 910 });
    const updated = await harness.base.settlements.find(request.id);
    assert.equal(updated?.mode, 'in_person');
    assert.notEqual(updated?.status, 'closed', 'долг закрывается только после подтверждения');
  });
});
