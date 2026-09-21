import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeField, questionnaireWeight, resolveAnswerMode } from '../src/domain/questionnaire.js';
import { validateAnswer, validateAnswers, describeConstraints, parseChoiceSelection } from '../src/domain/validation.js';
import type { EventField, FieldType } from '../src/domain/types.js';

const field = (type: FieldType, extra: Partial<EventField> = {}): EventField =>
  normalizeField({ id: `${type}-1`, label: 'Вопрос', type, ...extra });

describe('Вес анкеты и способ ответа', () => {
  it('считает вес по формуле из требований', () => {
    assert.equal(questionnaireWeight([field('text')]), 5);
    assert.equal(questionnaireWeight([field('number')]), 2);
    assert.equal(questionnaireWeight([field('date')]), 2);
    assert.equal(questionnaireWeight([field('yesno')]), 1);
    // выбор: floor(варианты / 3) + 1
    assert.equal(questionnaireWeight([field('choice', { options: ['a', 'b'] })]), 1);
    assert.equal(questionnaireWeight([field('choice', { options: ['a', 'b', 'c'] })]), 2);
    assert.equal(questionnaireWeight([field('choice', { options: Array.from({ length: 9 }, (_, i) => `o${i}`) })]), 4);
  });

  it('переключает чат и мини-приложение по порогу 10', () => {
    const light = [field('text'), field('yesno')]; // 6
    assert.equal(questionnaireWeight(light), 6);
    assert.equal(resolveAnswerMode(light, 'auto'), 'chat');

    const heavy = [field('text'), field('text')]; // 10
    assert.equal(questionnaireWeight(heavy), 10);
    assert.equal(resolveAnswerMode(heavy, 'auto'), 'miniapp');
  });

  it('уважает ручное переопределение', () => {
    const light = [field('yesno')];
    const heavy = [field('text'), field('text'), field('text')];
    assert.equal(resolveAnswerMode(light, 'miniapp'), 'miniapp');
    assert.equal(resolveAnswerMode(heavy, 'chat'), 'chat');
  });

  it('приводит старые поля к актуальному виду: обязательные и без ограничений', () => {
    const legacy = normalizeField({ id: 'x', label: 'Старый', type: 'text' } as Partial<EventField> & { type: FieldType });
    assert.equal(legacy.required, true);
    assert.equal(legacy.multiple, false);
    assert.equal(legacy.maxLength, null);
    assert.equal(legacy.min, null);
  });
});

describe('Ограничения ответов', () => {
  it('число: границы и формат', () => {
    const number = field('number', { min: 6, max: 99 });
    assert.equal(validateAnswer(number, '30').ok, true);
    assert.equal(validateAnswer(number, '').ok, false);
    assert.equal(validateAnswer(number, '5').ok, false);
    assert.equal(validateAnswer(number, '100').ok, false);
    assert.equal(validateAnswer(number, 'тридцать').ok, false);
    assert.deepEqual(validateAnswer(number, '30,5'), { ok: true, value: '30.5' });
  });

  it('текст: максимальная длина', () => {
    const text = field('text', { maxLength: 6 });
    assert.equal(validateAnswer(text, 'привет').ok, true);
    assert.equal(validateAnswer(text, 'привет!').ok, false);
    assert.equal(validateAnswer(text, 'слишком длинный ответ').ok, false);
    assert.equal(validateAnswer(text, '').ok, false);
    // Без явного ограничения действует защитный потолок в 500 символов.
    const unlimited = field('text');
    assert.equal(validateAnswer(unlimited, 'a'.repeat(500)).ok, true);
    assert.equal(validateAnswer(unlimited, 'a'.repeat(501)).ok, false);
  });

  it('дата: формат и существование дня', () => {
    const date = field('date');
    assert.deepEqual(validateAnswer(date, '25.10.2026'), { ok: true, value: '25.10.2026' });
    assert.deepEqual(validateAnswer(date, '2026-10-25'), { ok: true, value: '25.10.2026' });
    assert.deepEqual(validateAnswer(date, '25.10.26'), { ok: true, value: '25.10.2026' });
    assert.equal(validateAnswer(date, '31.02.2026').ok, false);
    assert.equal(validateAnswer(date, 'завтра').ok, false);
  });

  it('выбор: один вариант или несколько с границами', () => {
    const single = field('choice', { options: ['Новичок', 'Любитель', 'Опытный'] });
    assert.deepEqual(validateAnswer(single, '2'), { ok: true, value: 'Любитель' });
    assert.deepEqual(validateAnswer(single, 'опытный'), { ok: true, value: 'Опытный' });
    assert.equal(validateAnswer(single, 'Мастер').ok, false);

    const multi = field('choice', {
      options: ['Снеки', 'Напитки', 'Настолка', 'Ничего'],
      multiple: true,
      minSelected: 1,
      maxSelected: 3,
    });
    assert.deepEqual(validateAnswer(multi, '1 3'), { ok: true, value: 'Снеки, Настолка' });
    assert.deepEqual(validateAnswer(multi, 'Снеки, Напитки'), { ok: true, value: 'Снеки, Напитки' });
    assert.equal(validateAnswer(multi, '1 2 3 4').ok, false);
    assert.equal(validateAnswer(multi, '').ok, false);
    assert.deepEqual(parseChoiceSelection(multi, '2'), ['Напитки']);
  });

  it('да/нет принимает разные формы', () => {
    const yesno = field('yesno');
    assert.deepEqual(validateAnswer(yesno, 'да'), { ok: true, value: 'Да' });
    assert.deepEqual(validateAnswer(yesno, 'нет'), { ok: true, value: 'Нет' });
    assert.equal(validateAnswer(yesno, 'может быть').ok, false);
  });

  it('необязательный вопрос пропускает пустой ответ', () => {
    const optional = field('text', { required: false });
    assert.deepEqual(validateAnswer(optional, ''), { ok: true, value: '' });
    const required = field('text');
    assert.equal(validateAnswer(required, '   ').ok, false);
  });

  it('проверяет весь набор и возвращает первое проблемное поле', () => {
    const fields = [field('yesno'), field('number', { min: 1, max: 3 })];
    const ok = validateAnswers(fields, { [fields[0]!.id]: 'Да', [fields[1]!.id]: '2' });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.answers, { [fields[0]!.id]: 'Да', [fields[1]!.id]: '2' });

    const failed = validateAnswers(fields, { [fields[0]!.id]: 'Да', [fields[1]!.id]: '9' });
    assert.equal(failed.ok, false);
    assert.equal(failed.failedField?.id, fields[1]!.id);
    assert.match(failed.error ?? '', /максимум 3/);
  });

  it('описывает ограничения человеческим языком', () => {
    assert.match(describeConstraints(field('number', { min: 6, max: 99 })), /от 6 до 99/);
    assert.match(describeConstraints(field('text', { maxLength: 120 })), /до 120 символов/);
    assert.match(describeConstraints(field('date')), /ДД\.ММ\.ГГГГ/);
    assert.match(
      describeConstraints(field('choice', { options: ['a', 'b'], multiple: true, minSelected: 1, maxSelected: 2 })),
      /от 1 до 2/,
    );
    assert.match(describeConstraints(field('text', { required: false })), /необязательный/);
  });
});
