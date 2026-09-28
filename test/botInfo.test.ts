import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '@maxhub/max-bot-api';

import { botInfoPlaceholder, fetchBotInfo, publishCommands } from '../src/bot/botInfo.js';
import type { Logger } from '../src/logger.js';

/** Логгер-перехватчик: проверяем, что о проблеме честно пишут в лог. */
const createLogger = (): { logger: Logger; lines: Array<{ level: string; message: string }> } => {
  const lines: Array<{ level: string; message: string }> = [];
  const logger: Logger = {
    debug: (message) => lines.push({ level: 'debug', message }),
    info: (message) => lines.push({ level: 'info', message }),
    warn: (message) => lines.push({ level: 'warn', message }),
    error: (message) => lines.push({ level: 'error', message }),
    child: () => logger,
  };
  return { logger, lines };
};

const api = (overrides: Partial<Record<'getMyInfo' | 'setMyCommands', () => Promise<unknown>>>): Api =>
  ({
    getMyInfo: overrides.getMyInfo ?? (async () => ({ user_id: 1, username: 'bot' })),
    setMyCommands: overrides.setMyCommands ?? (async () => undefined),
  }) as unknown as Api;

describe('Знакомство с ботом не зависит от доступности MAX', () => {
  it('возвращает данные, когда платформа отвечает', async () => {
    const { logger, lines } = createLogger();
    const info = await fetchBotInfo(api({ getMyInfo: async () => ({ user_id: 42, username: 'dosug' }) }), logger);
    assert.equal(info?.user_id, 42);
    assert.equal(info?.username, 'dosug');
    assert.deepEqual(lines, []);
  });

  it('при обрыве связи не бросает исключение, а пишет в лог', async () => {
    const { logger, lines } = createLogger();
    // Так выглядит падение после отключения света: сеть ещё не поднялась.
    const broken = api({
      getMyInfo: async () => {
        throw Object.assign(new Error('fetch failed'), {
          cause: new Error('getaddrinfo EAI_AGAIN platform-api2.max.ru'),
        });
      },
    });

    const info = await fetchBotInfo(broken, logger);
    assert.equal(info, null, 'ошибка не должна прерывать запуск');
    assert.ok(
      lines.some((line) => line.level === 'error' && /MAX не ответил/.test(line.message)),
      `в логе нет объяснения: ${JSON.stringify(lines)}`,
    );
  });

  it('подсказки команд — необязательная часть', async () => {
    const { logger, lines } = createLogger();
    await publishCommands(
      api({
        setMyCommands: async () => {
          throw new Error('fetch failed');
        },
      }),
      [{ name: 'new', description: 'Создать событие' }],
      logger,
    );
    assert.ok(lines.some((line) => line.level === 'warn'));
  });
});

describe('Заглушка данных бота', () => {
  it('выглядит как пользователь MAX: SDK читает её в логах long polling', () => {
    const stub = botInfoPlaceholder('dosug_test_bot');
    assert.equal(typeof stub.username, 'string');
    assert.equal(stub.username, 'dosug_test_bot');
    assert.equal(stub.is_bot, true);
    assert.equal(typeof stub.user_id, 'number');
    assert.equal(stub.user_id, 0, 'нулевой id — признак «данные ещё не получены»');
  });

  it('без известного ника подставляет безопасное значение', () => {
    assert.equal(botInfoPlaceholder().username, 'bot');
  });
});
