import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка стартовых параметров мини-приложения (MAX Bridge → WebAppData).
 *
 * Алгоритм из документации платформы:
 *   secret_key    = HMAC-SHA256(key = "WebAppData", data = BOT_TOKEN)
 *   launch_params = отсортированные по ключу пары `key=value`, склеенные через \n, без hash
 *   подпись       = hex(HMAC-SHA256(key = secret_key, data = launch_params))
 * Подпись сравниваем с параметром hash.
 *
 * Проверять обязательно: без этого любой может прислать чужие ответы от имени другого
 * участника. Для локальной отладки есть режим MINIAPP_DEV=1 (тогда подпись не требуется,
 * но такой режим нельзя включать в проде).
 */
export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string | null;
}

export interface ParsedInitData {
  user: InitDataUser | null;
  startParam: string | null;
  authDate: Date | null;
  raw: Record<string, string>;
}

export const parseInitData = (initData: string): ParsedInitData => {
  const raw: Record<string, string> = {};
  for (const pair of initData.split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index);
    const value = decodeURIComponent(pair.slice(index + 1));
    raw[key] = value;
  }

  let user: InitDataUser | null = null;
  if (raw.user) {
    try {
      const parsed = JSON.parse(raw.user) as InitDataUser;
      if (typeof parsed?.id === 'number') user = parsed;
    } catch {
      user = null;
    }
  }

  const authDateSeconds = raw.auth_date ? Number(raw.auth_date) : Number.NaN;

  return {
    user,
    startParam: raw.start_param ?? null,
    authDate: Number.isFinite(authDateSeconds) ? new Date(authDateSeconds * 1000) : null,
    raw,
  };
};

export interface InitDataCheck {
  ok: boolean;
  reason?: string;
  data: ParsedInitData;
}

/** @param maxAgeSec допустимый возраст подписи (по документации рекомендуется ~1 час) */
/** Допустимое расхождение часов при проверке подписи запуска, секунды. */
const CLOCK_SKEW_SEC = 60;

export const validateInitData = (
  initData: string,
  botToken: string,
  maxAgeSec = 3600,
): InitDataCheck => {
  const data = parseInitData(initData);
  if (!initData || !data.raw.hash) {
    return { ok: false, reason: 'Нет данных для проверки подписи', data };
  }
  if (Object.keys(data.raw).filter((key) => key === 'hash').length !== 1) {
    return { ok: false, reason: 'Некорректная подпись', data };
  }

  const params = Object.entries(data.raw)
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const launchParams = params.map(([key, value]) => `${key}=${value}`).join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const signature = createHmac('sha256', secretKey).update(launchParams).digest('hex');

  const expected = Buffer.from(signature, 'utf8');
  const actual = Buffer.from(data.raw.hash, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'Подпись не совпадает', data };
  }

  if (data.authDate && maxAgeSec > 0) {
    // Возраст считаем в одну сторону: подпись «из будущего» — тоже признак
    // подделки, поэтому Math.abs здесь не годится. Минутная поправка — на
    // расхождение часов между телефоном и сервером.
    const ageSec = (Date.now() - data.authDate.getTime()) / 1000;
    if (ageSec > maxAgeSec || ageSec < -CLOCK_SKEW_SEC) {
      return { ok: false, reason: 'Данные запуска устарели, откройте приложение заново', data };
    }
  }

  return { ok: true, data };
};
