import { fmt, Keyboard } from '@maxhub/max-bot-api';

import { yandexMapsUrl, type PlaceCoords } from '../domain/maps.js';
import { CB } from './callbacks.js';

export type InlineButton = Parameters<typeof Keyboard.inlineKeyboard>[0][number][number];
export type KeyboardRows = Parameters<typeof Keyboard.inlineKeyboard>[0];

/** Готовое сообщение: текст, необязательная клавиатура и разметка. */
export interface MessageContent {
  text: string;
  keyboard?: KeyboardRows;
  /** Разметка MAX. Ставим markdown только там, где текст собран с экранированием. */
  format?: 'markdown' | 'html';
}

export const button = Keyboard.button;
export const inlineKeyboard = Keyboard.inlineKeyboard;

/** Короткие помощники: кнопка-callback и кнопка-ссылка. */
export const cb = (text: string, payload: string): InlineButton => button.callback(text, payload);
export const link = (text: string, url: string): InlineButton => button.link(text, url);

export const text = (value: string): MessageContent => ({ text: value });

/** Готовые ряды кнопок навигации — используются почти во всех экранах. */
export const cancelRow: KeyboardRows = [[cb('Отмена', CB.draftCancel)]];
export const menuRow: KeyboardRows = [[cb('В меню', CB.menuMain)]];

export const withKeyboard = (value: string, keyboard: KeyboardRows): MessageContent => ({
  text: value,
  keyboard,
});

/** То же, но с markdown: используется там, где адрес — кликабельная ссылка. */
export const withMarkdownKeyboard = (value: string, keyboard: KeyboardRows): MessageContent => ({
  text: value,
  keyboard,
  format: 'markdown',
});

/** Экранирование пользовательского текста для markdown-сообщений. */
export const escapeMarkdown = (value: string): string => fmt.escape(value);

/**
 * Адрес как ссылка на карту: «[антикафе Кубик, ул. Ленина 5](https://yandex.ru/maps/...)».
 * Так строка остаётся короткой, а карта «завёрнута» внутрь адреса.
 */
export const mapLink = (place: string, coords?: PlaceCoords | null): string =>
  fmt.link(escapeMarkdown(place), yandexMapsUrl(place, coords));

export const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

export const truncate = (value: string, max = 300): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

export const NO_VALUE = '—';

export const valueOrDash = (value: string | null | undefined): string =>
  value === null || value === undefined || value.trim() === '' ? NO_VALUE : value;
