import { newFieldId } from './ids.js';
import { createEmptyField } from './questionnaire.js';
import { FIELD_TYPE_LABELS, type EventField, type FieldType } from './types.js';

export interface PresetTemplate {
  key: string;
  name: string;
  description: string;
  fields: EventField[];
}

/** Помощник: поле пресета с нужными ограничениями (по умолчанию — обязательное). */
const field = (
  label: string,
  type: FieldType,
  extra: Partial<EventField> = {},
): EventField => ({ ...createEmptyField(label, type), id: newFieldId(), ...extra });

const single = (options: string[]): Partial<EventField> => ({ options, multiple: false });
const multi = (options: string[], minSelected: number, maxSelected: number): Partial<EventField> => ({
  options,
  multiple: true,
  minSelected,
  maxSelected,
});

/**
 * Предустановленные наборы вопросов. Организатор выбирает шаблон при создании
 * события и может дописать свои вопросы или снять обязательность.
 */
export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    key: 'boardgames',
    name: 'Настольная игра',
    description: 'Состав стола, опыт и что принести к игре',
    fields: [
      field('В какие игры хотите сыграть?', 'text', { maxLength: 200 }),
      field('Опыт в настолках', 'choice', single(['Новичок', 'Любитель', 'Опытный'])),
      field('Что принесёте к столу?', 'choice', multi(['Снеки', 'Напитки', 'Настолка', 'Ничего'], 1, 3)),
    ],
  },
  {
    key: 'birthday',
    name: 'День рождения',
    description: 'Подарки, состав гостей и предпочтения по еде',
    fields: [
      field('Пожелания по подарку', 'text', { maxLength: 200, required: false }),
      field('С кем придёте?', 'choice', single(['Один(а)', 'С парой', 'С детьми'])),
      field('Будете алкоголь?', 'yesno', { required: false }),
      field('Аллергии и ограничения в еде', 'text', { maxLength: 200, required: false }),
    ],
  },
  {
    key: 'meetup',
    name: 'Встреча',
    description: 'Удобное время и помощь с дорогой',
    fields: [
      field('Во сколько удобно прийти?', 'text', { maxLength: 60 }),
      field('Нужна помощь, как добраться?', 'yesno'),
    ],
  },
  {
    key: 'sport',
    name: 'Спорт',
    description: 'Уровень подготовки, экипировка, ограничения',
    fields: [
      field('Уровень подготовки', 'choice', single(['Новичок', 'Средний', 'Продвинутый'])),
      field('Размер футболки', 'choice', single(['XS', 'S', 'M', 'L', 'XL', 'XXL'])),
      field('Возраст', 'number', { min: 6, max: 99 }),
      field('Есть медицинские ограничения?', 'yesno'),
      field('Дата последней тренировки', 'date', { required: false }),
    ],
  },
  {
    key: 'trip',
    name: 'Поход или выезд',
    description: 'Снаряжение, даты и общий список покупок',
    fields: [
      field('Дата заезда', 'date'),
      field('Есть палатка?', 'yesno'),
      field('Есть спальник?', 'yesno'),
      field('Что возьмёте из общего снаряжения?', 'choice', multi(
        ['Горелка', 'Котелок', 'Тент', 'Аптечка', 'Топор', 'Фонарь'],
        1,
        3,
      )),
    ],
  },
];

export const presetKeyOf = (templateId: string): string | null =>
  templateId.startsWith('preset:') ? templateId.slice('preset:'.length) : null;

export const presetById = (templateId: string): PresetTemplate | undefined => {
  const key = presetKeyOf(templateId);
  return key ? PRESET_TEMPLATES.find((preset) => preset.key === key) : undefined;
};

/** Превращает предустановленный шаблон в набор полей события с новыми id. */
export const fieldsFromPreset = (preset: PresetTemplate): EventField[] =>
  preset.fields.map((item) => ({ ...item, id: newFieldId(), options: [...item.options] }));

export const describeField = (fieldItem: EventField): string => {
  const type = FIELD_TYPE_LABELS[fieldItem.type] ?? fieldItem.type;
  const options = fieldItem.type === 'choice' && fieldItem.options.length > 0
    ? ` (${fieldItem.options.join(' / ')}${fieldItem.multiple ? ', можно несколько' : ''})`
    : '';
  const limits: string[] = [];
  if (fieldItem.type === 'number') {
    if (fieldItem.min !== null && fieldItem.max !== null) limits.push(`${fieldItem.min}–${fieldItem.max}`);
    else if (fieldItem.min !== null) limits.push(`от ${fieldItem.min}`);
    else if (fieldItem.max !== null) limits.push(`до ${fieldItem.max}`);
  }
  if (fieldItem.type === 'text' && fieldItem.maxLength !== null) limits.push(`до ${fieldItem.maxLength} символов`);
  if (fieldItem.multiple) {
    if (fieldItem.minSelected !== null && fieldItem.maxSelected !== null) {
      limits.push(`выбрать ${fieldItem.minSelected}–${fieldItem.maxSelected}`);
    } else if (fieldItem.maxSelected !== null) {
      limits.push(`выбрать до ${fieldItem.maxSelected}`);
    }
  }
  const limitText = limits.length > 0 ? `, ${limits.join(', ')}` : '';
  const required = fieldItem.required ? 'обязательный' : 'необязательный';
  return `${fieldItem.label} — ${type}${options}${limitText}, ${required}`;
};
