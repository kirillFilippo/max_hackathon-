import type { Logger } from '../../logger.js';
import type { Db } from '../pool.js';

/**
 * Сторож соединения с PostgreSQL.
 *
 * Задача — не дать боту упасть и не потерять работу пользователей, когда база
 * недоступна: состояние соединения отмечается здесь, фасад хранилища по этому
 * флагу переключается на память, а в логах появляется внятное объяснение, что
 * происходит и сколько данных ждёт синхронизации.
 */

export interface ConnectionStatus {
  online: boolean;
  /** Когда состояние изменилось (ISO). */
  since: string;
  /** Последняя ошибка соединения — чтобы дежурный сразу видел причину. */
  lastError: string | null;
  /** Сколько подряд неудачных проверок. */
  failures: number;
  /** Сколько раз связь терялась с момента запуска. */
  outages: number;
}

/** Ошибка соединения с БД, а не бизнес-ошибка запроса. */
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // Класс 08 — сбой соединения, 57Pxx — администратор выключил сервер,
  // 53300/53400 — кончились соединения, 28P01 — неверный пароль (конфигурация),
  // 3D000 — базы нет. Последние два не «бизнес-ошибка»: повторять их на каждый
  // запрос бессмысленно, поэтому работаем из памяти, а сторож пингует базу.
  '28P01',
  '3D000',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
]);

export const isConnectionError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CONNECTION_CODES.has(code)) return true;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return /Connection terminated|Connection refused|timeout exceeded when trying to connect|Client has encountered a connection error|the database system is (starting up|shutting down)|too many clients|Connection ended|connect ECONNREFUSED|password authentication failed|database .* does not exist|role .* does not exist/i.test(
    message,
  );
};

export const describeError = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return code ? `${String(code)}: ${message}` : message;
};

/** Минимум, который нужен потребителям состояния связи (сессии, фасад). */
export interface ConnectionState {
  isOnline(): boolean;
  markOffline(error: unknown): void;
}

export interface ConnectionMonitorOptions {
  /** Как часто проверять связь, когда она есть, мс. */
  checkIntervalMs?: number;
  /** Как часто напоминать в логах, что база недоступна, мс. */
  heartbeatMs?: number;
  /** Что показать в логе про объём данных, которые ждут синхронизации. */
  describeState?: () => string;
  /** Вызывается, когда связь появилась (миграции, синхронизация, прогрев). */
  onRecovered?: () => Promise<void>;
}

const DEFAULT_CHECK_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 60_000;

export class ConnectionMonitor implements ConnectionState {
  private status: ConnectionStatus;
  private timer: NodeJS.Timeout | null = null;
  private lastHeartbeat = 0;
  private recovery: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly options: ConnectionMonitorOptions = {},
  ) {
    this.status = {
      online: true,
      since: new Date().toISOString(),
      lastError: null,
      failures: 0,
      outages: 0,
    };
  }

  /** Текущее состояние: фасад хранилища спрашивает его на каждом вызове. */
  isOnline(): boolean {
    return this.status.online;
  }

  current(): ConnectionStatus {
    return { ...this.status };
  }

  /** Проверка связи при старте: бот поднимается даже без базы. */
  async probe(): Promise<boolean> {
    try {
      await this.db.ping();
      return true;
    } catch (error) {
      this.markOffline(error);
      return false;
    }
  }

  /** Пометка «связи нет»: сюда попадаем и из проверки, и из ошибки запроса. */
  markOffline(error: unknown): void {
    const wasOnline = this.status.online;
    const message = describeError(error);
    this.status = {
      online: false,
      since: wasOnline ? new Date().toISOString() : this.status.since,
      lastError: message,
      failures: this.status.failures + 1,
      outages: wasOnline ? this.status.outages + 1 : this.status.outages,
    };

    if (wasOnline) {
      this.logger.error(
        `Нет связи с PostgreSQL (${message}). Продолжаю работать в памяти: `
          + 'данные не потеряются, но синхронизируются только после восстановления базы.',
      );
    }
  }

  /** Связь восстановилась: миграции, синхронизация, прогрев. */
  private async markOnline(): Promise<void> {
    if (this.status.online) return;
    const outageMs = Date.now() - new Date(this.status.since).getTime();
    const seconds = Math.round(outageMs / 1000);
    this.status = {
      online: true,
      since: new Date().toISOString(),
      lastError: null,
      failures: 0,
      outages: this.status.outages,
    };
    this.logger.info(
      `Связь с PostgreSQL восстановлена (обрыв длился ${seconds} с). Синхронизирую данные из памяти.`,
    );

    try {
      await this.options.onRecovered?.();
      this.logger.info('Синхронизация с PostgreSQL завершена.');
    } catch (error) {
      this.logger.error('Не удалось синхронизировать данные после восстановления связи', error);
      // Считаем, что связи всё ещё нет: следующая проверка попробует снова.
      this.status = {
        online: false,
        since: new Date().toISOString(),
        lastError: describeError(error),
        failures: this.status.failures + 1,
        outages: this.status.outages,
      };
    }
  }

  /** Одна проверка: пинг, при удаче — восстановление, при неудаче — «нытьё» в лог. */
  async check(): Promise<void> {
    if (!this.status.online) {
      try {
        await this.db.ping();
        await this.markOnline();
      } catch (error) {
        this.status = {
          online: false,
          since: this.status.since,
          lastError: describeError(error),
          failures: this.status.failures + 1,
          outages: this.status.outages,
        };
        this.complain();
      }
      return;
    }

    try {
      await this.db.ping();
      this.status.failures = 0;
    } catch (error) {
      this.markOffline(error);
      this.complain(true);
    }
  }

  /** Периодическое напоминание: что база недоступна и сколько данных ждёт. */
  private complain(force = false): void {
    const heartbeat = this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const now = Date.now();
    if (!force && now - this.lastHeartbeat < heartbeat) return;
    this.lastHeartbeat = now;

    const seconds = Math.round((now - new Date(this.status.since).getTime()) / 1000);
    const state = this.options.describeState?.() ?? '';
    this.logger.warn(
      `PostgreSQL недоступен ${seconds} с (проверок подряд: ${this.status.failures}, `
        + `обрывов с запуска: ${this.status.outages}). Последняя ошибка: ${this.status.lastError ?? '—'}.`
        + (state ? ` ${state}` : ''),
    );
  }

  start(): void {
    if (this.timer) return;
    const interval = this.options.checkIntervalMs ?? DEFAULT_CHECK_MS;
    this.timer = setInterval(() => {
      void this.check();
    }, interval);
    // Сторож не должен держать процесс при остановке.
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Восстановление по требованию: нужно там, где ошибка запроса уже случилась,
   * а ждать следующего тика не хочется (например, в обработчике команды).
   */
  async recover(): Promise<void> {
    if (this.recovery) return this.recovery;
    this.recovery = this.check().finally(() => {
      this.recovery = null;
    });
    return this.recovery;
  }
}
