import assert from 'node:assert/strict';
import { clampNumber, parseDecimal } from '../src/domain/text.js';
import { describe, it } from 'node:test';

import { parseItemNumbers } from '../src/services/itemService.js';
import { PRESET_TEMPLATES, fieldsFromPreset, describeField } from '../src/domain/presets.js';
import { FAQ_ITEMS } from '../src/domain/faq.js';
import { answerFaq, matchFaq } from '../src/services/faqService.js';
import { createEvent, startHarness, register } from './support.js';
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

describe('Разбор чисел и нормализация текста', () => {
  it('принимает запятую, пробелы и минус', () => {
    assert.equal(parseDecimal('2,5'), 2.5);
    assert.equal(parseDecimal('1 200'), 1200);
    assert.equal(parseDecimal(' -3 '), -3);
    assert.equal(parseDecimal(7), 7);
    assert.equal(parseDecimal('1200,50'), 1200.5);
  });

  it('возвращает null вместо мусора', () => {
    assert.equal(parseDecimal(''), null);
    assert.equal(parseDecimal('два'), null);
    assert.equal(parseDecimal('12,3,4'), null);
    assert.equal(parseDecimal(Number.NaN), null);
    assert.equal(parseDecimal(undefined), null);
  });

  it('ограничивает значение диапазоном', () => {
    assert.equal(clampNumber(5, 1, 3), 3);
    assert.equal(clampNumber(0, 1, 3), 1);
    assert.equal(clampNumber(2, 1, 3), 2);
  });
});
