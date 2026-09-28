import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';

/**
 * Время начала: если организатор указал только дату, бот спрашивает время
 * отдельным шагом. Раньше он молча ставил 19:00 и предлагал пересоздать событие.
 */
describe('Создание события: время спрашиваем отдельно', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  /** Создаёт событие до шага места и возвращает его из базы. */
  const createToPlace = async (chatId: number, dateLine: string, timeLine?: string) => {
    harness.clearSent();
    await harness.click('ev:new', { chatId, userId: chatId });
    await harness.sendText('Поход', { chatId, userId: chatId });
    await harness.sendText(dateLine, { chatId, userId: chatId });
    if (timeLine !== undefined) await harness.sendText(timeLine, { chatId, userId: chatId });
  };

  it('дата без времени: спрашиваем время и не подставляем своё', async () => {
    const chatId = 2500;
    await createToPlace(chatId, 'завтра');

    const question = harness.lastText(chatId);
    assert.match(question, /Во сколько начало/);
    // В подсказке только дата, без часов: «Дата: 29 сентября 2026, вт».
    assert.match(question, /Дата: \d{1,2} \p{L}+ \d{4}/u);
    assert.doesNotMatch(question, /Дата: [^\n]*\d{1,2}:\d{2}/u, 'в вопросе показано придуманное время');

    await harness.sendText('в 11', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Когда: .*11:00/);
    assert.match(harness.lastText(chatId), /Где встречаемся/);
  });

  it('принимает время в разных форматах', async () => {
    for (const [chatId, timeLine, expected] of [
      [2501, '19:00', '19:00'],
      [2502, 'в 19:00', '19:00'],
      [2503, '9', '09:00'],
      [2504, '9.30', '09:30'],
    ] as Array<[number, string, string]>) {
      await createToPlace(chatId, 'завтра', timeLine);
      assert.match(
        harness.lastText(chatId),
        new RegExp(`Когда: .*${expected}`),
        `формат «${timeLine}» не разобран`,
      );
    }
  });

  it('дата со временем сразу не задаёт лишнего вопроса', async () => {
    const chatId = 2510;
    await createToPlace(chatId, 'завтра в 11:00');
    assert.match(harness.lastText(chatId), /Когда: .*11:00/);
    assert.match(harness.lastText(chatId), /Где встречаемся/);
    assert.doesNotMatch(harness.lastText(chatId), /Во сколько начало/);
  });

  it('непонятное время переспрашивает, а не ставит своё', async () => {
    const chatId = 2520;
    await createToPlace(chatId, 'завтра');
    await harness.sendText('когда-нибудь', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Не понял время/);
    await harness.sendText('25:00', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Не понял время/);
    // После правильного ответа идём дальше.
    await harness.sendText('20:15', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Когда: .*20:15/);
  });
});
