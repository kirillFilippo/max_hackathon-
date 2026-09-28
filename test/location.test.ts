import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';

/**
 * Место встречи: адрес вводится текстом. Кнопки «Отправить геопозицию» больше нет
 * — мастер не должен зависеть от того, сумеет ли клиент прислать точку.
 */
describe('Место встречи: только адрес', () => {
  let harness: BotHarness;

  before(async () => {
    harness = await createBotHarness();
  });

  after(async () => {
    await harness.stop();
  });

  /** Доводит мастер создания события до шага места. */
  const gotoPlace = async (chatId: number): Promise<void> => {
    harness.clearSent();
    await harness.click('ev:new', { chatId, userId: chatId });
    await harness.sendText('Поход', { chatId, userId: chatId });
    await harness.sendText('завтра в 11:00', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Где встречаемся/);
  };

  it('на шаге места нет кнопки геопозиции', async () => {
    const chatId = 2100;
    await gotoPlace(chatId);

    const buttons = harness.lastButtons(chatId);
    assert.deepEqual(
      buttons.filter((button) => /геопозиц|местоположен/i.test(button.text)),
      [],
      'кнопка геопозиции всё ещё показывается',
    );
    // Подсказка говорит про адрес, а не про кнопку.
    assert.match(harness.lastText(chatId), /Напишите адрес/);
    assert.doesNotMatch(harness.lastText(chatId), /кнопкой ниже/);

    // И на экране подтверждения кнопки тоже нет.
    await harness.sendText('антикафе Кубик, ул. Ленина 5', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Проверьте адрес/);
    const confirmButtons = harness.lastButtons(chatId).map((button) => button.text);
    assert.deepEqual(
      confirmButtons.filter((text) => /геопозиц|уточнить/i.test(text)),
      [],
      'на экране подтверждения осталась кнопка геопозиции',
    );
    assert.ok(confirmButtons.includes('Адрес верный'));
  });

  it('адрес текстом проходит до подтверждения и дальше по мастеру', async () => {
    const chatId = 2101;
    await gotoPlace(chatId);
    await harness.sendText('парк Горького, вход у фонтана', { chatId, userId: chatId });

    const screen = harness.lastText(chatId);
    assert.match(screen, /Проверьте адрес/);
    assert.match(screen, /yandex\.ru\/maps/);
    assert.match(screen, /парк Горького/);

    await harness.click('draft:place:ok', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Описание|Расскажите/i);
  });

  it('даже если клиент прислал геопозицию, мастер ждёт адрес', async () => {
    const chatId = 2102;
    await gotoPlace(chatId);

    // Точка без текста: адрес ввести нельзя, поэтому бот просто повторяет шаг.
    await harness.sendLocation(55.7558, 37.6173, { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Где встречаемся/);
    assert.ok(!/Проверьте адрес/.test(harness.texts(chatId).join('\n')));

    // После текста адреса всё идёт обычным путём.
    await harness.sendText('лес у реки', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Проверьте адрес/);
  });

  it('«Ввести заново» возвращает к шагу места', async () => {
    const chatId = 2103;
    await gotoPlace(chatId);
    await harness.sendText('кафе на Ленина', { chatId, userId: chatId });
    await harness.click('draft:place:retry', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Где встречаемся/);
  });
});
