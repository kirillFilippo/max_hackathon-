export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

const describeError = (error: Error): string => {
  const parts = [error.stack ?? `${error.name}: ${error.message}`];
  let cause: unknown = (error as { cause?: unknown }).cause;
  for (let depth = 0; depth < 5 && cause; depth += 1) {
    if (cause instanceof Error) {
      parts.push(`caused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`);
      cause = (cause as { cause?: unknown }).cause;
    } else {
      parts.push(`caused by: ${String(cause)}`);
      break;
    }
  }
  return parts.join('\n  ');
};

const formatMeta = (meta: unknown): string => {
  if (meta === undefined) return '';
  if (meta instanceof Error) return ` ${describeError(meta)}`;
  if (typeof meta === 'string') return ` ${meta}`;
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' [unserializable]';
  }
};

export const createLogger = (level: LogLevel = 'info', scope = 'app'): Logger => {
  const threshold = LEVEL_ORDER[level] ?? LEVEL_ORDER.info;

  const log = (messageLevel: LogLevel, message: string, meta?: unknown) => {
    if (LEVEL_ORDER[messageLevel] < threshold) return;
    const line = `${new Date().toISOString()} [${messageLevel.toUpperCase()}] [${scope}] ${message}${formatMeta(meta)}`;
    if (messageLevel === 'error' || messageLevel === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    child: (childScope: string) => createLogger(level, `${scope}:${childScope}`),
  };
};
