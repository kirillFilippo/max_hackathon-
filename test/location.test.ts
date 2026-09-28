import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createBotHarness, type BotHarness } from './botHarness.js';

/**
 * Кнопка «Отправить геопозицию» на шаге места встречи. Проверяем оба пути:
 * точку разобрали — показываем адрес на карте; пришло вложение без координат —
 * объясняем, что делать, а не перерисовываем экран молча.
 */
describe('Место встречи и геопозиция', () => {
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
    await harness.sendText('завтра 19:00', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Где встречаемся/);
  };

  it('кнопка геопозиции доводит до подтверждения адреса', async () => {
    const chatId = 2100;
    await gotoPlace(chatId);
    // В клавиатуре шага есть кнопка запроса геопозиции (payload у неё пустой).
    assert.ok(
      harness.lastButtons(chatId).some((button) => button.text === 'Отправить геопозицию'),
      'нет кнопки отправки геопозиции',
    );

    await harness.sendLocation(55.7558, 37.6173, { chatId, userId: chatId });

    const screen = harness.lastText(chatId);
    assert.match(screen, /Проверьте адрес/);
    assert.match(screen, /yandex\.ru\/maps/);

    // Адрес подтверждаем — мастер идёт дальше, к описанию.
    await harness.click('draft:place:ok', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /шаг|Описание|Расскажите/i);
  });

  it('вложение без координат не оставляет пользователя без ответа', async () => {
    const chatId = 2101;
    await gotoPlace(chatId);

    // Так выглядит вложение, которое бот не смог разобрать как точку.
    await harness.sendText('', {
      chatId,
      userId: chatId,
      attachments: [{ type: 'file', payload: { url: 'https://example.invalid/file' } }],
    });

    const screen = harness.lastText(chatId);
    assert.match(screen, /Не разобрал геопозицию/);
    assert.ok(!/Проверьте адрес/.test(harness.texts(chatId).join('\n')), 'мастер ушёл дальше без адреса');
  });

  it('адрес текстом по-прежнему работает', async () => {
    const chatId = 2102;
    await gotoPlace(chatId);
    await harness.sendText('антикафе Кубик, ул. Ленина 5', { chatId, userId: chatId });
    assert.match(harness.lastText(chatId), /Проверьте адрес/);
    assert.match(harness.lastText(chatId), /yandex\.ru\/maps/);
  });
});
