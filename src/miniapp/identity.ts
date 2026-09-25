import { validateInitData } from './auth.js';
import type { MiniappDeps } from './contracts.js';

export interface MiniappIdentity {
  userId: number | null;
  name: string;
  username: string | null;
  error?: string;
}

/**
 * Кто открыл приложение: подпись запуска (initData) проверяется на сервере по
 * алгоритму MAX. В режиме `MINIAPP_DEV=1` подпись не требуется — только для
 * локальной отладки.
 */
export const identify = (
  deps: MiniappDeps,
  initDataValue: string,
  devUserId?: string | null,
): MiniappIdentity => {
  if (deps.devMode && !initDataValue) {
    const id = Number(devUserId ?? '1');
    return { userId: Number.isFinite(id) ? id : 1, name: 'Тестовый участник', username: null };
  }
  const check = validateInitData(initDataValue, deps.botToken);
  if (!check.ok || !check.data.user) {
    return {
      userId: null,
      name: '',
      username: null,
      error: check.reason ?? 'Не удалось проверить подпись запуска',
    };
  }
  const user = check.data.user;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Участник';
  return { userId: user.id, name, username: user.username ?? null };
};
