import { formatDateTime } from '../../../domain/datetime/index.js';
import { describeField } from '../../../domain/presets.js';
import { EFFECTIVE_MODE_LABELS, resolveAnswerMode } from '../../../domain/questionnaire.js';
import type { EventField, PlaceCoords } from '../../../domain/types.js';
import { CB } from '../../callbacks.js';
import {
  cb,
  escapeMarkdown,
  mapLink,
  truncate,
  valueOrDash,
  withKeyboard,
  withMarkdownKeyboard,
  type KeyboardRows,
  type MessageContent,
} from '../../message.js';
import type { EventDraftData } from '../../session.js';
import { type ViewOptions } from './common.js';

export const placePrompt = (): MessageContent =>
  withKeyboard(
    [
      'Шаг 3 из 6. Где встречаемся?',
      '',
      'Напишите адрес: улица, дом, ориентир или название места.',
      'Бот покажет точку на Яндекс.Картах и попросит подтвердить адрес.',
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

/** Экран подтверждения адреса: адрес-ссылка на карту и замечание, если ввод похож не на адрес. */
export const placeConfirm = (
  place: string,
  coords: PlaceCoords | null,
  warning: string | null,
): MessageContent => {
  const lines = ['Проверьте адрес', '', mapLink(place, coords)];
  if (warning) lines.push('', `Замечание: ${escapeMarkdown(warning)}`);
  lines.push('', 'Нажмите на адрес, чтобы открыть карту, и убедитесь, что точка верная.');

  const rows: KeyboardRows = [
    [cb('Адрес верный', CB.draftPlaceOk)],
    [cb('Ввести заново', CB.draftPlaceRetry)],
    [cb('Отмена', CB.draftCancel)],
  ];
  return withMarkdownKeyboard(lines.join('\n'), rows);
};

export const createSummary = (
  data: EventDraftData,
  fields: EventField[],
  options: ViewOptions,
): MessageContent => {
  const lines = [
    'Проверьте событие',
    '',
    `Название: ${valueOrDash(data.title)}`,
    `Когда: ${data.startsAt ? formatDateTime(data.startsAt, options.tz) : '—'}`,
    `Место: ${valueOrDash(data.place)}`,
    `Лимит: ${data.limit === null || data.limit === undefined ? 'без лимита' : `${data.limit} человек`}`,
  ];
  if (data.description?.trim()) lines.push(`Описание: ${truncate(data.description, 300)}`);
  const effective = resolveAnswerMode(fields, options.answerMode ?? 'auto');
  lines.push('', `Вопросы участникам: ${fields.length} (отвечают ${EFFECTIVE_MODE_LABELS[effective]})`);
  fields.forEach((field, index) => lines.push(`${index + 1}. ${describeField(field)}`));

  return withKeyboard(lines.join('\n'), [
    [cb('Опубликовать', CB.draftPublish)],
    [cb('Вернуться к вопросам', CB.draftBack), cb('Отмена', CB.draftCancel)],
  ]);
};
