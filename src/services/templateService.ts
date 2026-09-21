import type { Repositories } from '../db/repositories/index.js';
import { newFieldId } from '../domain/ids.js';
import { normalizeField } from '../domain/questionnaire.js';
import { describeField, fieldsFromPreset, PRESET_TEMPLATES, presetById } from '../domain/presets.js';
import type { EventField, Template } from '../domain/types.js';

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  fieldCount: number;
}

const PRESET_CREATED_AT = '1970-01-01T00:00:00.000Z';

export class TemplateService {
  constructor(private readonly repos: Repositories) {}

  /** Предустановленные шаблоны в виде обычных Template (id = preset:<key>). */
  presets(): Template[] {
    return PRESET_TEMPLATES.map((preset) => ({
      id: `preset:${preset.key}`,
      name: preset.name,
      fields: fieldsFromPreset(preset),
      builtin: true,
      ownerId: null,
      createdAt: PRESET_CREATED_AT,
    }));
  }

  custom(ownerId: number): Promise<Template[]> {
    return this.repos.templates.listByOwner(ownerId);
  }

  async options(ownerId: number): Promise<TemplateOption[]> {
    const custom = await this.custom(ownerId);
    return [
      ...PRESET_TEMPLATES.map((preset) => ({
        id: `preset:${preset.key}`,
        name: preset.name,
        description: preset.description,
        builtin: true,
        fieldCount: preset.fields.length,
      })),
      ...custom.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.fields.map((field) => field.label).join(', ') || 'без вопросов',
        builtin: false,
        fieldCount: template.fields.length,
      })),
    ];
  }

  async find(id: string, ownerId: number): Promise<Template | undefined> {
    const preset = presetById(id);
    if (preset) {
      return {
        id,
        name: preset.name,
        fields: fieldsFromPreset(preset),
        builtin: true,
        ownerId: null,
        createdAt: PRESET_CREATED_AT,
      };
    }
    const custom = await this.repos.templates.find(id);
    return custom && custom.ownerId === ownerId ? custom : undefined;
  }

  /** Поля шаблона с новыми id — правки события не влияют на шаблон. */
  async fieldsFor(id: string, ownerId: number): Promise<EventField[]> {
    const template = await this.find(id, ownerId);
    return template ? this.copyFields(template.fields) : [];
  }

  copyFields(fields: EventField[]): EventField[] {
    // Копируем вместе с ограничениями ответа: шаблон должен воспроизводиться один в один.
    return fields.map((field) => normalizeField({ ...field, id: newFieldId() }));
  }

  async createFromFields(ownerId: number, name: string, fields: EventField[]): Promise<Template> {
    return this.repos.templates.create(ownerId, name, this.copyFields(fields));
  }

  rename(id: string, ownerId: number, name: string): Promise<Template | null> {
    return this.repos.templates.rename(id, ownerId, name);
  }

  updateFields(id: string, ownerId: number, fields: EventField[]): Promise<Template | null> {
    return this.repos.templates.updateFields(id, ownerId, this.copyFields(fields));
  }

  remove(id: string, ownerId: number): Promise<boolean> {
    return this.repos.templates.delete(id, ownerId);
  }

  describeField = describeField;
}
