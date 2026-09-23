import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  buildInviteUrl,
  CB,
  cbEventCard,
  cbEventEditField,
  cbItemPrice,
  cbItemTake,
  cbMoneyShow,
  cbMoneyRequest,
  cbRegAnswer,
  cbRegStatus,
  cbShopShow,
  cbTemplateRename,
  cbTransferDetails,
  cbTransferReceived,
  eventCodeFromStartPayload,
  parseCallback,
} from '../src/bot/callbacks.js';
import { inlineKeyboard } from '../src/bot/message.js';
import { mainMenu, helpText } from '../src/bot/texts/common.js';
import {
  eventDetails,
  invitationCard,
  organizerEventCard,
  participantsPanel,
  placeConfirm,
  templateCard,
  templatesList,
} from '../src/bot/texts/event.js';
import { dutiesPanel, settlementPanel, transferCreditorCard, transferDebtorCard } from '../src/bot/texts/money.js';
import { finalReminder } from '../src/bot/texts/registration.js';
import { contentToExtra as toSendExtra } from '../src/bot/context.js';
import { myItems, reserveResult, shoppingList } from '../src/bot/texts/shopping.js';
import { createEvent, register, startHarness, type Harness } from './support.js';
import { toKopecks } from '../src/domain/money.js';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const assertNoEmoji = (value: string, what: string): void => {
  assert.doesNotMatch(value, EMOJI, `в «${what}» остались эмодзи`);
};

describe('callback payloads', () => {
  it('разбирает действие и аргументы', () => {
    assert.deepEqual(parseCallback(cbEventCard('A7K2Q')), { action: 'ev', args: ['card', 'A7K2Q'] });
    assert.deepEqual(parseCallback(cbEventEditField('A7K2Q', 'place')), {
      action: 'ev',
      args: ['set', 'A7K2Q', 'place'],
    });
    assert.deepEqual(parseCallback(cbShopShow('A7K2Q')), { action: 'shop', args: ['show', 'A7K2Q'] });
    assert.deepEqual(parseCallback(cbItemTake('A7K2Q', 'itm_1')), {
      action: 'item',
      args: ['take', 'A7K2Q', 'itm_1'],
    });
    assert.deepEqual(parseCallback(cbItemPrice('A7K2Q', 'itm_1')), {
      action: 'item',
      args: ['price', 'A7K2Q', 'itm_1'],
    });
    assert.deepEqual(parseCallback(cbMoneyShow('A7K2Q')), { action: 'money', args: ['show', 'A7K2Q'] });
    assert.deepEqual(parseCallback(cbMoneyRequest('A7K2Q')), { action: 'money', args: ['request', 'A7K2Q'] });
    assert.deepEqual(parseCallback(cbTransferDetails('trf_1')), { action: 'tr', args: ['details', 'trf_1'] });
    assert.deepEqual(parseCallback(cbTransferReceived('trf_1')), { action: 'tr', args: ['received', 'trf_1'] });
    assert.deepEqual(parseCallback(cbRegStatus('A7K2Q', 'going')), {
      action: 'reg',
      args: ['status', 'A7K2Q', 'going'],
    });
    assert.deepEqual(parseCallback(cbRegAnswer(2, '1')), { action: 'reg', args: ['answer', '2', '1'] });
    assert.deepEqual(parseCallback(CB.shopMine), { action: 'shop', args: ['mine'] });
  });

  it('сохраняет идентификатор шаблона с двоеточием', () => {
    const preset = parseCallback('tpl:use:preset:boardgames');
    assert.equal(preset.args.slice(1).join(':'), 'preset:boardgames');
    assert.deepEqual(parseCallback(cbTemplateRename('tpl_1')), { action: 'tpl', args: ['rename', 'tpl_1'] });
  });

  it('строит ссылку-приглашение и разбирает payload диплинка', () => {
    assert.equal(buildInviteUrl('DosugBot', 'A7K2Q'), 'https://max.ru/DosugBot?start=ev_A7K2Q');
    assert.equal(eventCodeFromStartPayload('ev_a7k2q'), 'A7K2Q');
    assert.equal(eventCodeFromStartPayload('promo'), null);
    assert.equal(eventCodeFromStartPayload(undefined), null);
  });
});

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
});

const buttonTexts = (content: { keyboard?: Array<Array<{ text: string }>> }): string[] =>
  (content.keyboard ?? []).flat().map((item) => item.text);

describe('Тексты бота', () => {
  it('меню и помощь без эмодзи', () => {
    const menu = mainMenu({ hasEvents: true, hasDuties: true });
    assertNoEmoji(menu.text, 'главное меню');
    assertNoEmoji(helpText().text, 'помощь');
    assert.match(menu.text, /Мои расчёты/);
  });

  it('карточка события содержит адрес, карту, код и ссылку', async () => {
    {
      const event = await createEvent(harness, { limit: 8 });
      const participants = await harness.participants.listByEvent(event.id);
      const card = organizerEventCard(event, harness.events.stats(event, participants), {
        tz: 'Europe/Moscow',
        botUsername: 'DosugTestBot',
      });

      assertNoEmoji(card.text, 'карточка события');
      assert.match(card.text, new RegExp(`Код события: ${event.code}`));
      assert.match(card.text, new RegExp(`https://max\\.ru/DosugTestBot\\?start=ev_${event.code}`));
      assert.match(card.text, /лимит 8/);
      // Карту в карточке не показываем: она приходит за час и в «Доп. информации».
      assert.doesNotMatch(card.text, /yandex\.ru\/maps/);
      assert.ok(buttonTexts(card).includes('Доп. информация'));
      assert.ok(card.keyboard);
    }
  });

  it('приглашение содержит ссылку на карту и кнопку записи', async () => {
    {
      const event = await createEvent(harness);
      const card = invitationCard(event, harness.events.stats(event, []), { tz: 'Europe/Moscow' });
      const buttons = (card.keyboard ?? []).flat();

      assertNoEmoji(card.text, 'приглашение');
      // Прямой ссылки на карту в приглашении нет — только через «Доп. информацию».
      assert.ok(!buttons.some((item) => item.type === 'link' && item.url.includes('yandex.ru/maps')));
      assert.ok(
        buttons.some((item) => item.type === 'callback' && item.payload.startsWith('reg:begin:')),
        'в приглашении нет кнопки «Записаться»',
      );
      assert.ok(buttons.some((item) => item.type === 'callback' && item.payload.startsWith('ev:info:')));
    }
  });

  it('адрес — это ссылка на карту, отдельного URL в тексте нет', async () => {
    const event = await createEvent(harness, { place: 'антикафе Кубик, ул. Ленина 5' });
    await harness.items.add(event.id, ['Продукты']);
    await register(harness, event.id, 1, 'Аня', 'going');
    const participants = await harness.participants.listByEvent(event.id);
    const items = await harness.items.list(event.id);

    const details = eventDetails(event, participants, items, { tz: 'Europe/Moscow' });
    assertNoEmoji(details.text, 'доп. информация');
    assert.equal(details.format, 'markdown');
    // Адрес сам является ссылкой: «[адрес](карта)».
    // Точка внутри подписи экранирована — так markdown не сломается.
    assert.match(details.text, /\[антикафе Кубик, ул\\\. Ленина 5\]\(https:\/\/yandex\.ru\/maps/);
    // Длинного URL отдельной строкой нет — это и было целью правки.
    assert.doesNotMatch(details.text, /^Карта: /m);
    assert.doesNotMatch(details.text, /\nhttps:\/\/yandex\.ru\/maps/);

    const reminder = finalReminder(
      event,
      harness.events.stats(event, participants),
      items,
      { tz: 'Europe/Moscow' },
    );
    assert.equal(reminder.format, 'markdown');
    assert.match(reminder.text, /Адрес: \[антикафе Кубик, ул\\\. Ленина 5\]\(https:\/\/yandex\.ru\/maps/);

    // Отдельной кнопки-ссылки на карту быть не должно: адрес в тексте кликабельный.
    const mapButtons = [
      ...(details.keyboard ?? []).flat(),
      ...(reminder.keyboard ?? []).flat(),
      ...(placeConfirm('антикафе Кубик, ул. Ленина 5', null, null).keyboard ?? []).flat(),
    ].filter((item) => item.type === 'link' && item.url.includes('yandex.ru/maps'));
    assert.equal(mapButtons.length, 0);
  });

  it('экранирует пользовательский текст в markdown-сообщениях', async () => {
    const event = await createEvent(harness, { place: 'бар «Ёлка_2*3»' });
    const details = eventDetails(event, [], [], { tz: 'Europe/Moscow' });
    // Символы разметки экранированы, иначе адрес сломал бы ссылку.
    assert.match(details.text, /Ёлка\\_2\\\*3/);
  });

  it('разметка попадает в параметры отправки', () => {
    const content = { text: 'Адрес: [место](https://yandex.ru/maps)', format: 'markdown' as const };
    const extra = toSendExtra(content);
    assert.equal(extra.format, 'markdown');
    assert.equal(toSendExtra({ text: 'без разметки' }).format, undefined);
  });

  it('экран подтверждения адреса предупреждает про сомнительный ввод', () => {
    const good = placeConfirm('антикафе Кубик, ул. Ленина 5', null, null);
    assertNoEmoji(good.text, 'подтверждение адреса');
    assert.match(good.text, /Проверьте адрес/);
    assert.doesNotMatch(good.text, /Замечание/);
    assert.match(placeConfirm('дом', null, 'Адрес слишком короткий — проверьте, что указали улицу и дом.').text, /Замечание/);
  });

  it('список покупок нумерует позиции и показывает, кому они достались', async () => {
    {
      const event = await createEvent(harness);
      await harness.items.add(event.id, ['Продукты', 'Вода']);
      await register(harness, event.id, 1, 'Аня');
      await harness.items.reserveByNumbers(event, 1, 'Аня', [1]);
      const items = await harness.items.list(event.id);

      const view = shoppingList(event, items, { isOrganizer: false, userId: 2 });
      assertNoEmoji(view.text, 'список покупок');
      assert.match(view.text, /1\. Продукты — Аня/);
      assert.match(view.text, /2\. Вода — свободно/);
      assert.match(view.text, /занято 1, свободно 1/);

      const outcome = await harness.items.reserveByNumbers(event, 2, 'Боря', [1, 2]);
      const result = reserveResult(event, outcome, await harness.items.list(event.id));
      assertNoEmoji(result.text, 'результат брони');
      assert.match(result.text, /Эти позиции уже заняты:/);
      assert.match(result.text, /Продукты — Аня/);
      assert.match(result.text, /Вода/);
    }
  });

  it('панель расчётов и карточки перевода без эмодзи и с суммами', async () => {
    {
      const event = await createEvent(harness);
      await harness.items.add(event.id, ['Продукты']);
      await register(harness, event.id, 1, 'Аня');
      await register(harness, event.id, 2, 'Боря');
      await harness.items.reserveByNumbers(event, 1, 'Аня', [1]);
      const items = await harness.items.list(event.id);
      await harness.items.setPaidAmount(items[0]!.id, 1, toKopecks(2000));

      const view = await harness.settlements.view(event);
      const panel = settlementPanel(view, [], {
        tz: 'Europe/Moscow',
        isOrganizer: true,
        nameOf: (userId) => (userId === 1 ? 'Аня' : 'Боря'),
      });
      assertNoEmoji(panel.text, 'панель расчётов');
      assert.match(panel.text, /Общие траты: 2 000 ₽/);
      assert.match(panel.text, /Боря → Аня: 1 000 ₽/);

      await harness.settlements.requestTransfers(event);
      const request = (await harness.settlements.listByEvent(event.id)).find((r) => r.fromUserId === 2)!;

      const debtor = transferDebtorCard({
        request,
        event,
        creditorName: 'Аня',
        items: ['Продукты'],
        profile: null,
        tz: 'Europe/Moscow',
      });
      assertNoEmoji(debtor.text, 'карточка должника');
      assert.match(debtor.text, /Вы должны: 1 000 ₽/);
      assert.match(debtor.text, /Кому: Аня/);
      assert.ok(buttonTexts(debtor).some((label) => label.includes('Отдам при встрече')));

      const creditor = transferCreditorCard({
        request: { ...request, status: 'details_sent' },
        event,
        debtorName: 'Боря',
        debtorProfile: {
          userId: 2,
          name: 'Боря',
          username: null,
          contact: '',
          bankName: 'Тинькофф',
          paymentHandle: '+7 999 000-00-00',
        },
      });
      assertNoEmoji(creditor.text, 'карточка получателя');
      assert.match(creditor.text, /Боря должен вам 1 000 ₽/);
      assert.match(creditor.text, /Тинькофф/);

      const duties = dutiesPanel({
        debts: [{ request, event, creditorName: 'Аня' }],
        credits: [],
      });
      assertNoEmoji(duties.text, 'мои расчёты');
      assert.match(duties.text, /Аня: 1 000 ₽/);
    }
  });

  it('мои позиции и панель участников читаемы без эмодзи', async () => {
    {
      const event = await createEvent(harness);
      await harness.items.add(event.id, ['Продукты']);
      await register(harness, event.id, 1, 'Аня', 'going');
      await register(harness, event.id, 2, 'Боря', 'maybe');
      await harness.items.reserveByNumbers(event, 1, 'Аня', [1]);

      const mine = myItems(event, await harness.items.mine(event.id, 1));
      assertNoEmoji(mine.text, 'мои позиции');
      assert.match(mine.text, /Продукты — сумма не указана/);

      const panel = participantsPanel(event, await harness.participants.listByEvent(event.id), {
        tz: 'Europe/Moscow',
      });
      assertNoEmoji(panel.text, 'панель участников');
      assert.match(panel.text, /Идут — 1/);
      assert.match(panel.text, /Под вопросом — 1/);
    }
  });

  it('шаблоны: список и карточка', async () => {
    {
      const created = await harness.templates.createFromFields(7, 'Мой шаблон', []);
      const list = templatesList([created], harness.templates.presets().slice(0, 2));
      assertNoEmoji(list.text, 'список шаблонов');
      assert.match(list.text, /Мой шаблон/);
      assert.match(list.text, /Настольная игра/);

      const card = templateCard(created);
      assertNoEmoji(card.text, 'карточка шаблона');
      assert.deepEqual(buttonTexts(card), ['Изменить вопросы', 'Переименовать', 'Удалить', 'К шаблонам']);
    }
  });

  it('inline-клавиатура собирается из рядов кнопок', () => {
    const keyboard = inlineKeyboard([[{ type: 'callback', text: 'Тест', payload: 'test' }]]);
    assert.equal(keyboard.type, 'inline_keyboard');
    assert.equal(keyboard.payload.buttons[0]?.[0]?.text, 'Тест');
  });
});
