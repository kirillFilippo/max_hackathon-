import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';

/** Отладочные команды: событие с людьми за один вызов. */
describe('Отладочные команды', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  it('debugcreateevent создаёт событие организатора и наполняет его людьми', async () => {
    harness.clearSent();
    await harness.sendText('/debugcreateevent', { chatId: 800, userId: 800 });

    assert.match(harness.texts(800).join('\n'), /Отладочное событие создано/);

    const events = await harness.base.events.listByOrganizer(800);
    assert.equal(events.length, 1);
    const event = events[0]!;

    const participants = await harness.base.participants.listByEvent(event.id);
    assert.ok(participants.length >= 8, `участников: ${participants.length}`);
    // Мест шесть: кто-то обязательно уходит в лист ожидания.
    assert.ok(participants.some((item) => item.waitlisted), 'нет листа ожидания');
    assert.ok(participants.some((item) => item.status === 'maybe'), 'нет «под вопросом»');
    assert.ok(participants.some((item) => item.status === 'not_going'), 'нет отказавшихся');
    // Все синтетические участники — с отрицательными id, сообщения им не уходят.
    assert.ok(participants.every((item) => item.userId < 0));

    const items = await harness.base.items.list(event.id);
    assert.equal(items.length, 4);
    assert.equal(items.filter((item) => item.reservation !== null).length, 2);
    assert.ok(items.some((item) => (item.reservation?.paidKopecks ?? 0) > 0), 'нет сумм');

    // Расчёты подготовлены: в карточке события есть что показать.
    const transfers = await harness.base.settlements.listByEvent(event.id);
    assert.ok(transfers.length > 0, 'нет запросов на перевод');

    // Организатор видит карточку события с кодом и ссылкой.
    assert.match(harness.lastText(800), new RegExp(event.code));
  });

  it('debugreceiveevent записывает вызывающего участником', async () => {
    harness.clearSent();
    await harness.sendText('/debugreceiveevent', { chatId: 801, userId: 801 });

    assert.match(harness.texts(801).join('\n'), /Вы записаны в отладочное событие/);

    const events = await harness.base.events.listForUser(801);
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.notEqual(event.organizerId, 801, 'событие должно принадлежать «чужому» организатору');

    const me = await harness.base.participants.find(event.id, 801);
    assert.equal(me?.status, 'maybe');
    assert.equal(me?.waitlisted, false);

    // Участнику есть что делать: свободные позиции списка покупок.
    const items = await harness.base.items.list(event.id);
    assert.ok(items.some((item) => item.reservation === null), 'нет свободных позиций');
  });

  it('синтетическим участникам не отправляются сообщения', async () => {
    harness.clearSent();
    await harness.sendText('/debugcreateevent', { chatId: 802, userId: 802 });
    const event = (await harness.base.events.listByOrganizer(802))[0]!;
    const synthetic = (await harness.base.participants.listByEvent(event.id))[0]!;
    assert.ok(synthetic.userId < 0, 'синтетический участник должен иметь отрицательный id');

    // Доставка синтетику: сообщение не уходит (в MAX такого пользователя нет).
    const before = harness.sent.length;
    await harness.deps.notifier.sendToUser(synthetic.userId, { text: 'проверка', keyboard: [] });
    assert.equal(harness.sent.length, before, 'сообщение ушло синтетическому участнику');

    // Доставка реальному пользователю работает как обычно.
    await harness.deps.notifier.sendToUser(802, { text: 'проверка', keyboard: [] });
    assert.equal(harness.sent.length, before + 1);
    assert.match(harness.lastText(802), /проверка/);
  });

  it('отладочные команды выключаются настройкой', async () => {
    const off = await createBotHarness({ debugCommands: false });
    try {
      off.clearSent();
      await off.sendText('/debugcreateevent', { chatId: 803, userId: 803 });
      assert.doesNotMatch(off.texts(803).join('\n'), /Отладочное событие создано/);
      const events = await off.base.events.listByOrganizer(803);
      assert.equal(events.length, 0, 'команда сработала при выключенной отладке');
    } finally {
      await off.stop();
    }
  });
});
