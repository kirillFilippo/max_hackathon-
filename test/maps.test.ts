import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addressWarning, isMapsUrl, normalizePlace, yandexMapsUrl } from '../src/domain/maps.js';

describe('yandexMapsUrl', () => {
  it('строит ссылку по текстовому адресу', () => {
    const url = yandexMapsUrl('антикафе Кубик, ул. Ленина 5');
    assert.match(url, /^https:\/\/yandex\.ru\/maps\/\?text=/);
    assert.match(url, /%D0%9B%D0%B5%D0%BD%D0%B8%D0%BD%D0%B0/);
  });

  it('добавляет координаты, если организатор отправил геопозицию', () => {
    const url = yandexMapsUrl('Точка сбора', { lat: 55.751244, lon: 37.618423 });
    assert.match(url, /ll=37\.618423,55\.751244/);
    assert.match(url, /z=17/);
    assert.match(url, /text=/);
  });

  it('не трогает готовую ссылку', () => {
    const ready = 'https://yandex.ru/maps/?pt=37.6,55.7&z=18';
    assert.equal(yandexMapsUrl(ready, null), ready);
    assert.equal(isMapsUrl(ready), true);
  });

  it('работает с пустым адресом и координатами', () => {
    assert.match(yandexMapsUrl('', { lat: 1, lon: 2 }), /text=1%2C2|text=1,2/);
  });
});

describe('addressWarning', () => {
  it('не ругается на нормальный адрес', () => {
    assert.equal(addressWarning('антикафе Кубик, ул. Ленина 5'), null);
    assert.equal(addressWarning('Москва, Парк Горького'), null);
    assert.equal(addressWarning('https://yandex.ru/maps/?text=test'), null);
  });

  it('предупреждает про слишком короткий адрес', () => {
    assert.match(addressWarning('дом') ?? '', /слишком короткий/);
  });

  it('предупреждает, если нет ни номера дома, ни ориентира', () => {
    assert.match(addressWarning('Центральный район') ?? '', /ориентир/);
  });

  it('предупреждает, если в строке нет букв', () => {
    assert.match(addressWarning('55.7512, 37.6184') ?? '', /нет букв|номер дома/);
  });
});

describe('normalizePlace', () => {
  it('схлопывает пробелы и убирает кавычки', () => {
    assert.equal(normalizePlace('  «антикафе   Кубик»  '), 'антикафе Кубик');
    assert.equal(normalizePlace('ул. Ленина 5 , 2 этаж'), 'ул. Ленина 5, 2 этаж');
  });
});
