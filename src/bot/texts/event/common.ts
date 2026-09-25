import type { AnswerMode } from '../../../domain/types.js';

/** Общие параметры отображения события: часовой пояс и ник бота для ссылок. */
export interface ViewOptions {
  tz: string;
  botUsername?: string;
  /** Режим анкеты — нужен для сводки создания события. */
  answerMode?: AnswerMode;
  /** Диплинк мини-приложения с анкетой, когда участники отвечают там. */
  answersUrl?: string;
}

/** Сколько участников перечисляем в панели, дальше — «и ещё N». */
export const MAX_LISTED = 15;

/** Сколько вопросов показываем строками «Удалить: …», дальше — только счётчик. */
export const MAX_EDITOR_FIELDS = 8;
