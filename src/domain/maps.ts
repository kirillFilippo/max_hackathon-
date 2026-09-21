/**
 * Работа с адресом события: проверка «похоже ли на адрес» и ссылка на Яндекс.Карты.
 * Внешний геокодер не используется: у хакатонного MVP нет ключей и внешних API,
 * поэтому «двойная проверка» — это подтверждение адреса организатором плюс
 * ссылка-превью, по которой он глазами проверяет точку на карте.
 */

import type { PlaceCoords } from './types.js';

export type { PlaceCoords };

export const looksLikeUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

export const isMapsUrl = (value: string): boolean =>
  /^https?:\/\/(yandex\.[a-z]+|maps\.yandex\.[a-z]+|2gis\.[a-z]+|google\.[a-z]+\/maps)/i.test(value.trim());

/** Ссылка на Яндекс.Карты: по текстовому адресу, по координатам или готовая ссылка. */
export const yandexMapsUrl = (place: string, coords?: PlaceCoords | null): string => {
  const trimmed = place.trim();
  if (looksLikeUrl(trimmed)) return trimmed;

  const query = trimmed || (coords ? `${coords.lat},${coords.lon}` : '');
  if (coords) {
    return `https://yandex.ru/maps/?ll=${coords.lon},${coords.lat}&z=17&text=${encodeURIComponent(query)}`;
  }
  return `https://yandex.ru/maps/?text=${encodeURIComponent(query)}`;
};

/**
 * Возвращает предупреждение, если строка мало похожа на адрес.
 * null — организатору можно показывать адрес как есть.
 */
export const addressWarning = (place: string): string | null => {
  const value = place.trim();
  if (isMapsUrl(value)) return null;
  if (value.length < 5) return 'Адрес слишком короткий — проверьте, что указали улицу и дом.';
  if (!/[a-zA-Zа-яА-Я]/.test(value)) return 'В адресе нет букв — похоже, это не адрес.';
  if (!/\d/.test(value) && !/ул|улица|пр|проспект|пер|переулок|шоссе|пл|площадь|наб|д\.|дом|кафе|бар|клуб|антикафе|парк|мкр|микрорайон/i.test(value)) {
    return 'В адресе нет номера дома или ориентира — участники могут не найти место.';
  }
  return null;
};

/** Нормализует пользовательский ввод адреса: схлопывает пробелы, убирает лишние кавычки. */
export const normalizePlace = (place: string): string =>
  place
    .trim()
    .replace(/^[«"']|[»"']$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .slice(0, 200);
