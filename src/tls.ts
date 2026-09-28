import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Logger } from './logger.js';

/**
 * Сертификаты и MAX API.
 *
 * Замер на реальном стенде: `https://platform-api2.max.ru` не проходит проверку
 * системным хранилищем Node (причина — `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`),
 * потому что корневой сертификат Russian Trusted Root CA (Минцифры) не входит в
 * список Mozilla. Поэтому сертификат лежит в репозитории
 * (`certs/russian-trusted-root-ca.pem`) и копируется в образ: в Dockerfile задан
 * `NODE_EXTRA_CA_CERTS`, и бот работает сразу после `docker compose up --build` —
 * ни монтировать каталог, ни указывать путь не нужно.
 *
 * Логика ниже нужна для остальных случаев:
 *   1. сертификата нет → работаем на системном хранилище; если его там нет, бот
 *      напишет понятную инструкцию вместо «fetch failed»;
 *   2. сертификат есть, а переменная не выставлена (запуск без Docker или со своим
 *      файлом) → бот перезапускает себя с `NODE_EXTRA_CA_CERTS`, потому что Node
 *      читает эту переменную только при старте процесса.
 */
export const DEFAULT_CA_CERT_PATH = path.join('certs', 'russian-trusted-root-ca.pem');
export const CA_ENV_VAR = 'MAX_CA_CERT_PATH';
const REEXEC_FLAG = 'MAX_CA_CERT_REEXEC';

export const resolveCaCertPath = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const explicit = env[CA_ENV_VAR];
  if (explicit) return explicit;
  const fallback = path.resolve(process.cwd(), DEFAULT_CA_CERT_PATH);
  return existsSync(fallback) ? fallback : null;
};

export interface CaCertState {
  /** Путь к дополнительному сертификату, который реально используется. */
  activePath: string | null;
  /** Сертификат найден, но процесс ещё не перезапущен с NODE_EXTRA_CA_CERTS. */
  needsRestart: boolean;
  note: string;
}

export const inspectCaCert = (env: NodeJS.ProcessEnv = process.env): CaCertState => {
  const fromEnv = env.NODE_EXTRA_CA_CERTS;
  if (fromEnv) {
    if (existsSync(fromEnv)) {
      return {
        activePath: fromEnv,
        needsRestart: false,
        note: `дополнительный корневой сертификат подключён: ${fromEnv}`,
      };
    }
    return {
      activePath: null,
      needsRestart: false,
      note:
        `NODE_EXTRA_CA_CERTS=${fromEnv} — файл не найден, Node его проигнорирует `
        + 'и продолжит работу с системными сертификатами.',
    };
  }

  const candidate = resolveCaCertPath(env);
  if (candidate && existsSync(candidate)) {
    return {
      activePath: candidate,
      needsRestart: env[REEXEC_FLAG] !== '1',
      note: `найден дополнительный корневой сертификат: ${candidate}`,
    };
  }

  return {
    activePath: null,
    needsRestart: false,
    note:
      'дополнительный сертификат не задан — используем системное хранилище Node. '
      + 'Это нормальный режим: сертификат нужен только если платформа отказывает по TLS.',
  };
};

/**
 * Перезапускает процесс с NODE_EXTRA_CA_CERTS, если сертификат найден, а переменная
 * ещё не выставлена. Возвращает true, если родительский процесс должен завершиться
 * (управление передано дочернему).
 */
export const reexecWithCaCert = async (logger: Logger, env: NodeJS.ProcessEnv = process.env): Promise<boolean> => {
  const state = inspectCaCert(env);
  if (!state.needsRestart || !state.activePath) return false;

  const { spawn } = await import('node:child_process');
  logger.info(
    `Подключаю корневой сертификат ${state.activePath} и перезапускаю процесс `
    + '(Node читает NODE_EXTRA_CA_CERTS только при старте).',
  );

  const child = spawn(process.execPath, process.argv.slice(1), {
    env: {
      ...env,
      NODE_EXTRA_CA_CERTS: state.activePath,
      [REEXEC_FLAG]: '1',
    },
    stdio: 'inherit',
  });

  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));

  const code: number = await new Promise((resolve) => {
    child.on('exit', (exitCode, signal) => {
      resolve(exitCode ?? (signal ? 1 : 0));
    });
  });
  process.exitCode = code;
  return true;
};

const CERT_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

/** Ищет код TLS-ошибки в самой ошибке и в цепочке `cause` (fetch прячет причину). */
export const isCertificateError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const code = (current as { code?: string }).code ?? '';
    if (CERT_ERROR_CODES.has(code)) return true;
    const message = current instanceof Error ? current.message : String(current);
    if (/certificate|self[- ]signed|unable to verify|unable to get local issuer|ssl/i.test(message)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

export const certificateHint = (): string =>
  'Платформа MAX не прошла проверку TLS-сертификата. Порядок действий:\n'
  + '  1. Если на машине уже установлены корневые сертификаты Минцифры — ничего делать не нужно.\n'
  + `  2. Иначе положите файл в ./${DEFAULT_CA_CERT_PATH} (или укажите путь в ${CA_ENV_VAR});\n`
  + '     бот сам перезапустится с NODE_EXTRA_CA_CERTS и подключит его к системным.\n'
  + '  3. В Docker: каталог ./certs монтируется в /app/certs, файл с этим именем подхватится автоматически.\n'
  + '  Сертификат добавляется к системным, а не заменяет их.';
