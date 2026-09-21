import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeSettlement, formatRub, parsePriceKopecks, toKopecks } from '../src/domain/money.js';
import { parseItemNumbers } from '../src/services/itemService.js';
import { PRESET_TEMPLATES, fieldsFromPreset, describeField } from '../src/domain/presets.js';
import { FAQ_ITEMS, answerFaq, matchFaq } from '../src/services/faqService.js';
import { createEvent, startHarness, register } from './support.js';
import type { SettlementItem } from '../src/domain/types.js';

const item = (
  title: string,
  reservedBy: [number, string] | null,
  paidKopecks: number | null,
): SettlementItem => ({
  id: title,
  title,
  reservedByUserId: reservedBy?.[0] ?? null,
  reservedByName: reservedBy?.[1] ?? null,
  paidKopecks,
});

describe('computeSettlement', () => {
  it('делит общие траты поровну и считает переводы', () => {
    const settlement = computeSettlement(
      [item('Продукты', [1, 'Аня'], toKopecks(3000)), item('Напитки', [2, 'Боря'], toKopecks(1000))],
      [
        { userId: 1, name: 'Аня' },
        { userId: 2, name: 'Боря' },
      ],
    );

    assert.equal(settlement.totalKopecks, 400_000);
    assert.equal(settlement.perPersonKopecks, 200_000);
    assert.deepEqual(
      settlement.paid.map((entry) => [entry.name, entry.amountKopecks]),
      [
        ['Аня', 300_000],
        ['Боря', 100_000],
      ],
    );
    assert.deepEqual(settlement.transfers, [
      { fromUserId: 2, fromName: 'Боря', toUserId: 1, toName: 'Аня', amountKopecks: 100_000 },
    ]);
  });

  it('считает раскладку на трёх участников и показывает остаток округления', () => {
    const settlement = computeSettlement(
      [item('Продукты', [1, 'Аня'], toKopecks(1000))],
      [
        { userId: 1, name: 'Аня' },
        { userId: 2, name: 'Боря' },
        { userId: 3, name: 'Вика' },
      ],
    );

    assert.equal(settlement.perPersonKopecks, 33_333);
    assert.equal(settlement.roundingRemainderKopecks, 1);
    assert.deepEqual(
      settlement.transfers.map((transfer) => [transfer.fromName, transfer.toName, transfer.amountKopecks]),
      [
        ['Боря', 'Аня', 33_333],
        ['Вика', 'Аня', 33_333],
      ],
    );
  });

  it('не учитывает позиции без суммы и без брони', () => {
    const settlement = computeSettlement(
      [item('Мангал', null, null), item('Продукты', [1, 'Аня'], null), item('Вода', [1, 'Аня'], toKopecks(500))],
      [{ userId: 1, name: 'Аня' }],
    );

    assert.equal(settlement.totalKopecks, 50_000);
    assert.deepEqual(settlement.itemsWithoutAmount.map((entry) => entry.title), ['Продукты']);
    assert.deepEqual(settlement.unreservedItems.map((entry) => entry.title), ['Мангал']);
  });

  it('учитывает расход участника, который не отмечен идущим', () => {
    const settlement = computeSettlement(
      [item('Продукты', [9, 'Гость'], toKopecks(1000))],
      [{ userId: 1, name: 'Аня' }],
    );
    assert.ok(settlement.paid.some((entry) => entry.name === 'Гость'));
  });

  it('не падает без участников', () => {
    const settlement = computeSettlement([item('Продукты', [1, 'Аня'], toKopecks(100))], []);
    assert.equal(settlement.perPersonKopecks, 0);
    assert.deepEqual(settlement.transfers, []);
  });
});

describe('parsePriceKopecks и formatRub', () => {
  it('разбирает суммы', () => {
    assert.equal(parsePriceKopecks('350'), 35_000);
    assert.equal(parsePriceKopecks('350,50'), 35_050);
    assert.equal(parsePriceKopecks('1 200 ₽'), 120_000);
    assert.equal(parsePriceKopecks('бесплатно'), null);
    assert.equal(parsePriceKopecks('0'), null);
    assert.equal(parsePriceKopecks('сколько-то'), undefined);
  });

  it('печатает рубли', () => {
    assert.equal(formatRub(35_000), '350 ₽');
    assert.equal(formatRub(35_050), '350,50 ₽');
    assert.equal(formatRub(120_000), '1 200 ₽');
  });
});

describe('parseItemNumbers', () => {
  it('разбирает номера позиций', () => {
    assert.deepEqual(parseItemNumbers('1 2 3'), [1, 2, 3]);
    assert.deepEqual(parseItemNumbers('1,2,4'), [1, 2, 4]);
    assert.deepEqual(parseItemNumbers('1-3'), [1, 2, 3]);
    assert.deepEqual(parseItemNumbers('3 1 3'), [1, 3]);
    assert.deepEqual(parseItemNumbers('нет'), []);
    assert.deepEqual(parseItemNumbers(''), []);
  });
});

describe('предустановленные шаблоны', () => {
  it('содержат поля без emoji в подписях', () => {
    assert.equal(PRESET_TEMPLATES.length, 5);
    for (const preset of PRESET_TEMPLATES) {
      assert.doesNotMatch(preset.name, /[\u{1F300}-\u{1FAFF}]/u);
      const fields = fieldsFromPreset(preset);
      assert.ok(fields.length > 0);
      for (const field of fields) {
        assert.ok(field.id.startsWith('fld_'));
        assert.doesNotMatch(describeField(field), /[\u{1F300}-\u{1FAFF}]/u);
      }
    }
  });
});

describe('FAQ', () => {
  it('находит тему по ключевым словам', () => {
    assert.equal(matchFaq('а где встречаемся?')?.key, 'where');
    assert.equal(matchFaq('во сколько начало')?.key, 'when');
    assert.equal(matchFaq('что взять с собой?')?.key, 'bring');
    assert.equal(matchFaq('кто кому должен')?.key, 'money');
    assert.equal(matchFaq('расскажи анекдот'), null);
    assert.equal(FAQ_ITEMS.length, 8);
  });

  it('без события отвечает общими словами', () => {
    const item = FAQ_ITEMS.find((faq) => faq.key === 'where')!;
    assert.match(answerFaq(item, { tz: 'Europe/Moscow' }), /карточке события/);
  });

  it('с событием и списком покупок отвечает данными', async () => {
    const harness = await startHarness();
    try {
      const event = await createEvent(harness, { limit: 2, place: 'антикафе Кубик' });
      await register(harness, event.id, 1, 'Аня', 'going');
      await register(harness, event.id, 2, 'Боря', 'going');
      await harness.items.add(event.id, ['Продукты', 'Вода']);
      const items = await harness.items.list(event.id);
      await harness.items.reserveByNumbers(event, 1, 'Аня', [1]);

      const fresh = await harness.events.findById(event.id);
      const participants = await harness.participants.listByEvent(event.id);
      const context = {
        event: fresh!,
        participants,
        items: await harness.items.list(event.id),
        stats: harness.events.stats(fresh!, participants),
        tz: 'Europe/Moscow',
      };

      assert.match(answerFaq(FAQ_ITEMS.find((f) => f.key === 'where')!, context), /антикафе Кубик/);
      assert.match(answerFaq(FAQ_ITEMS.find((f) => f.key === 'who')!, context), /Аня, Боря/);
      assert.match(answerFaq(FAQ_ITEMS.find((f) => f.key === 'limit')!, context), /Лимит 2 исчерпан/);
      assert.match(answerFaq(FAQ_ITEMS.find((f) => f.key === 'bring')!, context), /Свободно: Вода/);
      assert.equal(items.length, 2);
    } finally {
      await harness.stop();
    }
  });
});
