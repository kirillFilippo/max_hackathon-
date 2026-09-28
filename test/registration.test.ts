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

describe('Отмена и повторные нажатия в мастере заявки', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  const setup = async () =>
    harness.base.events.create({
      title: 'Настолки',
      description: '',
      startsAt: hoursFromNow(48),
      place: 'кафе',
      placeCoords: null,
      limit: null,
      fields: [],
      answerMode: 'auto',
      organizerId: 3300,
      organizerName: 'Оля',
    });

  it('«Отмена» работает на каждом шаге мастера', async () => {
    for (const [chatId, prepare] of [
      [3301, async (code: string) => { await harness.click(`reg:begin:${code}`, { chatId: 3301, userId: 3301 }); }],
      [3302, async (code: string) => {
        await harness.click(`reg:begin:${code}`, { chatId: 3302, userId: 3302 });
        await harness.sendText('Аня', { chatId: 3302, userId: 3302 });
      }],
      [3303, async (code: string) => {
        await harness.click(`reg:begin:${code}`, { chatId: 3303, userId: 3303 });
        await harness.sendText('Аня', { chatId: 3303, userId: 3303 });
        await harness.click('reg:contact:skip', { chatId: 3303, userId: 3303 });
      }],
    ] as Array<[number, (code: string) => Promise<void>]>) {
      harness.clearSent();
      const event = await setup();
      await harness.start(`ev_${event.code}`, { chatId, userId: chatId });
      await prepare(event.code);

      await harness.click('reg:cancel', { chatId, userId: chatId });
      assert.match(harness.lastText(chatId), /Заявка отменена/, `отмена не сработала в чате ${chatId}`);

      // Черновик снят: следующий текст обрабатывается как обычное сообщение.
      harness.clearSent();
      await harness.sendText('привет', { chatId, userId: chatId });
      assert.doesNotMatch(harness.lastText(chatId), /Как вас записать|Контакт для связи|Вы придёте/);
    }
  });

  it('повторное «Иду» не возвращает вопрос про участие', async () => {
    harness.clearSent();
    const event = await setup();
    const chatId = 3310;

    await harness.start(`ev_${event.code}`, { chatId, userId: chatId });
    await harness.click(`reg:begin:${event.code}`, { chatId, userId: chatId });
    await harness.sendText('Вика', { chatId, userId: chatId });
    await harness.click('reg:contact:skip', { chatId, userId: chatId });

    // Двойной тап и осознанный повтор той же кнопки.
    await harness.click(`reg:status:${event.code}:going`, { chatId, userId: chatId, rapid: true });
    await harness.click(`reg:status:${event.code}:going`, { chatId, userId: chatId, rapid: true });
    await harness.click(`reg:status:${event.code}:going`, { chatId, userId: chatId });

    const screens = harness.texts(chatId);
    const confirmAt = screens.findIndex((text) => text.startsWith('Проверьте заявку'));
    assert.ok(confirmAt >= 0, 'мастер не дошёл до подтверждения заявки');
    assert.deepEqual(
      screens.slice(confirmAt + 1).filter((text) => text.includes('Вы придёте?')),
      [],
      'вопрос про участие вернулся после выбора статуса',
    );
  });

  it('повтор кнопок «имя» и «контакт» из старого сообщения не откатывает шаг', async () => {
    harness.clearSent();
    const event = await setup();
    const chatId = 3320;

    await harness.start(`ev_${event.code}`, { chatId, userId: chatId });
    await harness.click(`reg:begin:${event.code}`, { chatId, userId: chatId });
    await harness.sendText('Гриша', { chatId, userId: chatId });
    await harness.click('reg:contact:skip', { chatId, userId: chatId });
    await harness.click(`reg:status:${event.code}:going`, { chatId, userId: chatId });

    // Старые кнопки из предыдущих сообщений: мастер должен остаться на месте.
    harness.clearSent();
    await harness.click('reg:contact:skip', { chatId, userId: chatId, mid: 'old-contact' });
    await harness.click(`reg:name:${event.code}`, { chatId, userId: chatId, mid: 'old-name' });

    const after = harness.texts(chatId).join('\n');
    assert.match(after, /Проверьте заявку|Статус уже выбран/);
    assert.doesNotMatch(after, /Как вас записать/);
  });
});
