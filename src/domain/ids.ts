import { randomInt, randomUUID } from 'node:crypto';

/** Алфавит без похожих символов (I/O/0/1), чтобы код легко диктовать голосом. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

export const newEventCode = (length = 5): string => {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
};

export const newEventId = (): string => newId('evt');

export const newFieldId = (): string => newId('fld');

export const newItemId = (): string => newId('itm');

export const newParticipantId = (): string => newId('prt');

export const newTemplateId = (): string => newId('tpl');

/** Приводит введённый пользователем код к каноническому виду. */
export const normalizeCode = (raw: string): string =>
  raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * Синтетический пользователь отладочного события: нужен, чтобы посмотреть
 * карточки и состав события, но в MAX такого человека нет. Отрицательный id —
 * признак «сообщения этому пользователю не доставляем»: настоящие id в MAX
 * всегда положительные.
 */
export const syntheticUserId = (index: number): number => -(1000 + index);

export const isSyntheticUserId = (userId: number): boolean => userId < 0;
