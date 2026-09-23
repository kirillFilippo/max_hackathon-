import { existsSync } from 'node:fs';
import path from 'node:path';

import type { LogLevel } from './logger.js';

export type BotMode = 'polling' | 'webhook';

export interface AppConfig {
  /** Токен бота MAX. Обязателен для запуска в MAX, не нужен для тестов. */
  botToken: string;
  botMode: BotMode;
  webhookUrl?: string;
  webhookPath: string;
  webhookPort: number;
  webhookSecret?: string;
  /** Строка подключения PostgreSQL: состояние живёт в БД и переживает деплой. */
  databaseUrl: string;
  databasePoolSize: number;
  databaseSsl: boolean;
  /** Публичный HTTPS-адрес мини-приложения (конструктор вопросов). Пусто — функция выключена. */
  miniappUrl?: string;
  /** Локальный порт HTTP-сервера мини-приложения. */
  miniappPort: number;
  /** Разрешить мини-приложению работать без подписи запуска (только локально). */
  miniappDev: boolean;
  appTz: string;
  botUsername?: string;
  reminderConfirmHours: number;
  reminderFinalHours: number;
  reminderTickSeconds: number;
  /** Как часто проверять, что подписка на вебхук жива (режим webhook). */
  webhookCheckSeconds: number;
  sessionTtlHours: number;
  logLevel: LogLevel;
}

export const PLACEHOLDER_TOKENS = new Set([
  '',
  'replace_me_with_real_bot_token',
  'your_token',
  'token',
]);

export const DEFAULT_DATABASE_URL = 'postgres://dosug:dosug@localhost:5432/dosug';

const readString = (env: NodeJS.ProcessEnv, name: string, fallback = ''): string => {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
};

const readNumber = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const raw = readString(env, name);
  if (raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolean = (env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean => {
  const raw = readString(env, name).toLowerCase();
  if (raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const readLogLevel = (env: NodeJS.ProcessEnv): LogLevel => {
  const raw = readString(env, 'LOG_LEVEL', 'info').toLowerCase();
  return raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info';
};

/** Подхватывает .env, если файл есть. Уже заданные переменные имеют приоритет. */
export const loadEnvFile = (file = path.resolve(process.cwd(), '.env')): void => {
  if (!existsSync(file)) return;
  const loader = (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loader !== 'function') return;
  try {
    loader.call(process, file);
  } catch {
    // Некорректный .env не должен ронять процесс.
  }
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const mode = readString(env, 'BOT_MODE', 'polling').toLowerCase();
  const botUsername = readString(env, 'BOT_USERNAME').replace(/^@/, '');

  return {
    botToken: readString(env, 'BOT_TOKEN'),
    botMode: mode === 'webhook' ? 'webhook' : 'polling',
    webhookUrl: readString(env, 'WEBHOOK_URL') || undefined,
    webhookPath: readString(env, 'WEBHOOK_PATH', '/max/webhook'),
    webhookPort: readNumber(env, 'WEBHOOK_PORT', 8080),
    webhookSecret: readString(env, 'WEBHOOK_SECRET') || undefined,
    databaseUrl: readString(env, 'DATABASE_URL', DEFAULT_DATABASE_URL),
    databasePoolSize: readNumber(env, 'DATABASE_POOL_SIZE', 10),
    databaseSsl: readBoolean(env, 'DATABASE_SSL', false),
    miniappUrl: readString(env, 'MINIAPP_URL') || undefined,
    miniappPort: readNumber(env, 'MINIAPP_PORT', 8090),
    miniappDev: readBoolean(env, 'MINIAPP_DEV', false),
    appTz: readString(env, 'APP_TZ', 'Europe/Moscow'),
    botUsername: botUsername || undefined,
    reminderConfirmHours: readNumber(env, 'REMINDER_CONFIRM_HOURS', 48),
    reminderFinalHours: readNumber(env, 'REMINDER_FINAL_HOURS', 1),
    reminderTickSeconds: readNumber(env, 'REMINDER_TICK_SECONDS', 60),
    webhookCheckSeconds: readNumber(env, 'WEBHOOK_CHECK_SECONDS', 60),
    sessionTtlHours: readNumber(env, 'SESSION_TTL_HOURS', 24),
    logLevel: readLogLevel(env),
  };
};

/** Проверяет, что конфигурации достаточно для подключения к MAX и PostgreSQL. */
export const assertRunnableConfig = (config: AppConfig): void => {
  if (PLACEHOLDER_TOKENS.has(config.botToken)) {
    throw new Error(
      'BOT_TOKEN не задан. Скопируйте .env.example в .env и укажите токен бота MAX '
      + '(токен выдаёт @MasterBot). Токен нельзя коммитить в репозиторий.',
    );
  }
  if (!config.databaseUrl.startsWith('postgres://') && !config.databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL должен начинаться с postgres:// или postgresql://');
  }
  if (config.reminderFinalHours >= config.reminderConfirmHours) {
    throw new Error('REMINDER_FINAL_HOURS должен быть меньше REMINDER_CONFIRM_HOURS');
  }
  if (config.miniappUrl && !config.miniappUrl.startsWith('https://')) {
    throw new Error('MINIAPP_URL должен быть HTTPS: мини-приложения MAX открываются только по HTTPS');
  }
  if (config.botMode === 'webhook') {
    if (!config.webhookUrl) {
      throw new Error('Для BOT_MODE=webhook задайте WEBHOOK_URL (публичный HTTPS-адрес)');
    }
    if (!config.webhookUrl.startsWith('https://')) {
      throw new Error('WEBHOOK_URL должен быть HTTPS: платформа MAX не принимает HTTP-вебхуки');
    }
  }
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: config.appTz });
  } catch {
    throw new Error(`APP_TZ="${config.appTz}" не является корректным часовым поясом IANA`);
  }
};
