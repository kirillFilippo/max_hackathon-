import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { runReminderTick } from '../src/bot/reminderRunner.js';
import { createEvent, register, startHarness, type Harness } from './support.js';

let harness: Harness;

const HOUR = 3_600_000;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.stop();
});

beforeEach(async () => {
  // Каждый тест начинает с чистого состояния: сообщения и события не смешиваются.
  await harness.reset();
});

describe('Напоминания', () => {
  it('ничего не отправляет задолго до события', async () => {
    const event = await createEvent(harness, { startsAt: new Date(Date.now() + 240 * HOUR).toISOString() });
    await register(harness, event.id, 1, 'Аня');

    const result = await runReminderTick(harness.deps, new Date());

    assert.deepEqual(result, { confirmSent: 0, finalSent: 0, closed: 0, errors: 0 });
    assert.equal(harness.notifier.messages.length, 0);
  });

  it('за 48 часов просит подтвердить участие и не повторяет сообщение', async () => {
    const start = new Date(Date.now() + 50 * HOUR);
    const event = await createEvent(harness, { startsAt: start.toISOString() });
    await register(harness, event.id, 1, 'Аня', 'going');
    await register(harness, event.id, 2, 'Боря', 'maybe');
    await register(harness, event.id, 3, 'Вика', 'not_going');

    const window = new Date(start.getTime() - 47 * HOUR);
    const first = await runReminderTick(harness.deps, window);
    assert.equal(first.confirmSent, 2);
    assert.match(harness.notifier.messagesFor(1)[0]?.text ?? '', /Подтвердите участие/);

    const second = await runReminderTick(harness.deps, new Date(window.getTime() + HOUR));
    assert.equal(second.confirmSent, 0);
    assert.equal(harness.notifier.messages.length, 2);
  });

  it('за час отправляет детали и не повторяет подтверждение', async () => {
    const start = new Date(Date.now() + 50 * HOUR);
    const event = await createEvent(harness, { startsAt: start.toISOString() });
    await register(harness, event.id, 1, 'Аня', 'going');
    await harness.items.add(event.id, ['Продукты', 'Вода']);
    await harness.items.reserveByNumbers(event, 1, 'Аня', [1]);

    await runReminderTick(harness.deps, new Date(start.getTime() - 47 * HOUR));
    const result = await runReminderTick(harness.deps, new Date(start.getTime() - 30 * 60_000));

    assert.equal(result.confirmSent, 0);
    assert.equal(result.finalSent, 1);
    const texts = harness.notifier.messagesFor(1).map((message) => message.text);
    assert.equal(texts.length, 2);
    assert.match(texts[1] ?? '', /Скоро встреча/);
    assert.match(texts[1] ?? '', /Свободно в списке покупок: Вода/);
  });

  it('не просит подтверждение, если событие создано уже внутри окна', async () => {
    const event = await createEvent(harness, { startsAt: new Date(Date.now() + 5 * HOUR).toISOString() });
    await register(harness, event.id, 1, 'Аня');

    const result = await runReminderTick(harness.deps, new Date());
    assert.equal(result.confirmSent, 0);
  });

  it('повторяет отправку после сбоя доставки', async () => {
    const start = new Date(Date.now() + 50 * HOUR);
    const event = await createEvent(harness, { startsAt: start.toISOString() });
    await register(harness, event.id, 1, 'Аня');

    harness.notifier.failFor.add(1);
    const failed = await runReminderTick(harness.deps, new Date(start.getTime() - 47 * HOUR));
    assert.equal(failed.confirmSent, 0);
    assert.equal(failed.errors, 1);

    harness.notifier.failFor.delete(1);
    const retried = await runReminderTick(harness.deps, new Date(start.getTime() - 46 * HOUR));
    assert.equal(retried.confirmSent, 1);
  });

  it('закрывает прошедшие события и не напоминает по ним', async () => {
    const event = await createEvent(harness, { startsAt: new Date(Date.now() - 5 * HOUR).toISOString() });
    await register(harness, event.id, 1, 'Аня');

    const result = await runReminderTick(harness.deps, new Date());

    assert.equal(result.closed, 1);
    assert.equal((await harness.events.findById(event.id))?.status, 'closed');
    assert.equal(harness.notifier.messages.length, 0);
  });
});
