import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BotContext } from '../src/bot/context.js';
import { UpdateDeduplicator, isRepeatableAction } from '../src/bot/middleware/dedupe.js';
import { createLogger } from '../src/logger.js';

const silent = createLogger('error');

interface FakeUpdate {
  update_type: string;
  timestamp: number;
  message?: { body?: { mid?: string } };
  callback?: { payload?: string };
  user?: { user_id: number };
}

const ctxOf = (update: FakeUpdate): BotContext => ({ update } as unknown as BotContext);

const callback = (payload: string, mid = 'mid-1', timestamp = 1000): FakeUpdate => ({
  update_type: 'message_callback',
  timestamp,
  message: { body: { mid } },
  callback: { payload },
  user: { user_id: 7 },
});

const message = (mid: string, timestamp = 1000): FakeUpdate => ({
  update_type: 'message_created',
  timestamp,
  message: { body: { mid } },
  user: { user_id: 7 },
});

describe('Защита от повторной обработки действий', () => {
  it('пропускает повторное нажатие той же кнопки в том же сообщении', () => {
    const dedupe = new UpdateDeduplicator(silent);

    // Двойной тап: одинаковый mid и payload, но разные timestamp.
    assert.equal(dedupe.isDuplicate(ctxOf(callback('draft:skip', 'mid-1', 1000))), false);
    assert.equal(dedupe.isDuplicate(ctxOf(callback('draft:skip', 'mid-1', 1050))), true);
    assert.equal(dedupe.isDuplicate(ctxOf(callback('draft:skip', 'mid-1', 1090))), true);
  });

  it('пропускает повторно доставленное обновление целиком', () => {
    const dedupe = new UpdateDeduplicator(silent);
    const update = callback('ev:card:A7K2Q', 'mid-2', 2000);

    assert.equal(dedupe.isDuplicate(ctxOf(update)), false);
    assert.equal(dedupe.isDuplicate(ctxOf({ ...update })), true);
  });

  it('не мешает разным действиям и разным сообщениям', () => {
    const dedupe = new UpdateDeduplicator(silent);

    assert.equal(dedupe.isDuplicate(ctxOf(callback('draft:skip', 'mid-3'))), false);
    // Другая кнопка в том же сообщении — новое действие.
    assert.equal(dedupe.isDuplicate(ctxOf(callback('draft:publish', 'mid-3'))), false);
    // Та же кнопка, но в другом сообщении — тоже новое действие.
    assert.equal(dedupe.isDuplicate(ctxOf(callback('draft:skip', 'mid-4'))), false);
  });

  it('разрешает осознанно нажать ту же кнопку позже', async () => {
    const dedupe = new UpdateDeduplicator(silent, { actionTtlMs: 20 });

    assert.equal(dedupe.isDuplicate(ctxOf(callback('ev:people:A7K2Q', 'mid-5'))), false);
    assert.equal(dedupe.isDuplicate(ctxOf(callback('ev:people:A7K2Q', 'mid-5'))), true);

    await new Promise((resolve) => setTimeout(resolve, 30));
    // «Обновить» через полминуты снова работает: у нового нажатия свой timestamp.
    assert.equal(dedupe.isDuplicate(ctxOf(callback('ev:people:A7K2Q', 'mid-5', 5000))), false);
  });

  it('обычные текстовые сообщения не считаются дублями', () => {
    const dedupe = new UpdateDeduplicator(silent);
    assert.equal(dedupe.isDuplicate(ctxOf(message('msg-1', 1000))), false);
    assert.equal(dedupe.isDuplicate(ctxOf(message('msg-2', 1100))), false);
    // А точная повторная доставка того же сообщения — дубль.
    assert.equal(dedupe.isDuplicate(ctxOf(message('msg-1', 1000))), true);
  });

  it('не мешает повторять действия-переключатели', () => {
    const dedupe = new UpdateDeduplicator(silent);

    // Мультивыбор: второй тап по тому же варианту снимает галочку — это не дубль.
    assert.equal(dedupe.isDuplicate(ctxOf(callback('reg:toggle:0:1', 'mid-6', 1000))), false);
    assert.equal(dedupe.isDuplicate(ctxOf(callback('reg:toggle:0:1', 'mid-6', 1050))), false);
    assert.equal(isRepeatableAction('reg:toggle:0:1'), true);
    assert.equal(isRepeatableAction('draft:skip'), false);

    // Точная повторная доставка того же обновления всё равно отсекается.
    assert.equal(dedupe.isDuplicate(ctxOf(callback('reg:toggle:0:1', 'mid-6', 1050))), true);
  });

  it('ограничивает размер памяти', () => {
    const dedupe = new UpdateDeduplicator(silent, { maxEntries: 10, actionTtlMs: 60_000 });
    for (let index = 0; index < 50; index += 1) {
      dedupe.isDuplicate(ctxOf(callback(`draft:skip`, `mid-${index}`, 1000 + index)));
    }
    assert.ok(dedupe.size <= 10, `карта выросла до ${dedupe.size}`);
  });
});
