import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { runReminderTick } from '../src/bot/reminderRunner.js';
import { createBotHarness, type BotHarness } from './botHarness.js';

describe('Репро: подтверждение из напоминания', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  it('участник подтверждает участие кнопкой в напоминании', async () => {
    harness.clearSent();
    const start = new Date(Date.now() + 50 * 3_600_000);
    const event = await harness.base.events.create({
      title: 'Настолки',
      description: '',
      startsAt: start.toISOString(),
      place: 'кафе на Ленина',
      placeCoords: null,
      limit: null,
      fields: [],
      answerMode: 'auto',
      organizerId: 500,
      organizerName: 'Тестировщик',
    });
    await harness.base.participants.save({
      event,
      userId: 700,
      name: 'Аня',
      username: 'anya',
      contact: '@anya',
      status: 'maybe',
      answers: {},
    });

    const window = new Date(start.getTime() - 47 * 3_600_000);
    const result = await runReminderTick(harness.base.deps, window);
    console.log('напоминаний:', result);

    harness.clearSent();
    // Участник нажимает «Иду» прямо в напоминании.
    await harness.click(`reg:status:${event.code}:going`, { chatId: 700, userId: 700 });
    console.log('ответ на нажатие:', harness.lastText(700));
    console.log('кнопки:', JSON.stringify(harness.lastButtons(700)));

    const participant = await harness.base.participants.find(event.id, 700);
    console.log('статус в базе:', participant?.status);
    assert.equal(participant?.status, 'going');
  });
});
