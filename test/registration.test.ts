import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';
import { hoursFromNow } from './support.js';

/**
 * Подтверждение участия не должно зависеть от незакрытых черновиков:
 * «Иду» из напоминания — это не шаг мастера регистрации.
 */
describe('Подтверждение участия кнопками', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  const createEvent = async () =>
    harness.base.events.create({
      title: 'Настолки',
      description: '',
      startsAt: hoursFromNow(50),
      place: 'кафе на Ленина',
      placeCoords: null,
      limit: null,
      fields: [],
      answerMode: 'auto',
      organizerId: 500,
      organizerName: 'Тестировщик',
    });

  it('подтверждает участие, даже если остался брошенный черновик регистрации', async () => {
    harness.clearSent();
    const event = await createEvent();

    // Участник начал регистрацию и бросил её на шаге контакта.
    await harness.start(`ev_${event.code}`, { chatId: 700, userId: 700 });
    await harness.click(`reg:begin:${event.code}`, { chatId: 700, userId: 700 });
    await harness.sendText('Аня', { chatId: 700, userId: 700 });
    assert.match(harness.lastText(700), /Контакт для связи/);

    // Пришло напоминание, участник жмёт «Иду». Кнопка не должна уходить в старый
    // черновик: бот доводит заявку до конца с уже выбранным статусом.
    harness.clearSent();
    await harness.click(`reg:status:${event.code}:going`, { chatId: 700, userId: 700 });
    assert.match(harness.lastText(700), /Контакт для связи/, 'кнопку напоминания съел черновик');

    await harness.click('reg:contact:skip', { chatId: 700, userId: 700 });
    assert.match(harness.lastText(700), /Проверьте заявку/);
    assert.match(harness.lastText(700), /Статус: Иду/);

    await harness.click(`reg:confirm:${event.code}`, { chatId: 700, userId: 700 });
    const participant = await harness.base.participants.find(event.id, 700);
    assert.equal(participant?.status, 'going', 'статус из напоминания не применился');
  });

  it('кнопка «Всё верно, отправить» отвечает, когда черновик потерян', async () => {
    harness.clearSent();
    const event = await createEvent();

    await harness.click(`reg:confirm:${event.code}`, { chatId: 701, userId: 701 });
    assert.match(harness.lastText(701), /Черновик заявки потерян|Как вас записать/);

    // Старое сообщение без кода события тоже получает внятный ответ.
    harness.clearSent();
    await harness.click('reg:confirm', { chatId: 702, userId: 702 });
    assert.match(harness.lastText(702), /Кнопка устарела/);
  });

  it('мастер регистрации по-прежнему доводит заявку до конца', async () => {
    harness.clearSent();
    const event = await createEvent();

    await harness.start(`ev_${event.code}`, { chatId: 703, userId: 703 });
    await harness.click(`reg:begin:${event.code}`, { chatId: 703, userId: 703 });
    await harness.sendText('Боря', { chatId: 703, userId: 703 });
    await harness.click('reg:contact:skip', { chatId: 703, userId: 703 });
    await harness.click(`reg:status:${event.code}:going`, { chatId: 703, userId: 703 });
    assert.match(harness.lastText(703), /Проверьте заявку/);

    await harness.click(`reg:confirm:${event.code}`, { chatId: 703, userId: 703 });
    assert.match(harness.lastText(703), /Ваша заявка принята/);

    const participant = await harness.base.participants.find(event.id, 703);
    assert.equal(participant?.status, 'going');
    assert.equal(participant?.name, 'Боря');
  });

  it('статус чужого события не подменяет шаг мастера', async () => {
    harness.clearSent();
    const first = await createEvent();
    const second = await createEvent();

    // Мастер по первому событию стоит на шаге статуса.
    await harness.start(`ev_${first.code}`, { chatId: 704, userId: 704 });
    await harness.click(`reg:begin:${first.code}`, { chatId: 704, userId: 704 });
    await harness.sendText('Вика', { chatId: 704, userId: 704 });
    await harness.click('reg:contact:skip', { chatId: 704, userId: 704 });
    assert.match(harness.lastText(704), /Вы придёте/);

    // Приходит напоминание по второму событию: применяется его статус.
    const secondParticipant = await harness.base.participants.save({
      event: second,
      userId: 704,
      name: 'Вика',
      username: null,
      contact: '',
      status: 'maybe',
      answers: {},
    });
    assert.equal(secondParticipant.ok, true);

    harness.clearSent();
    await harness.click(`reg:status:${second.code}:going`, { chatId: 704, userId: 704 });
    const updated = await harness.base.participants.find(second.id, 704);
    assert.equal(updated?.status, 'going');
  });
});
