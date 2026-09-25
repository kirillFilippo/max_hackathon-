import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

import type { MiniappDeps, MiniappHandle } from './contracts.js';
import { createMiniappHandler } from './routes.js';

/**
 * HTTP-сервер мини-приложения конструктора вопросов. Живёт в том же процессе, что
 * и бот, поэтому отдельного сервиса в compose не требуется: страницы, API и
 * вебхук MAX — на одном порту (MINIAPP_PORT).
 *
 * Маршруты лежат в `routes.ts`, приведение данных — в `sanitize.ts`, проверка
 * подписи запуска — в `identity.ts`; здесь только жизненный цикл сервера.
 */
export * from './contracts.js';

export const startMiniappServer = async (deps: MiniappDeps): Promise<MiniappHandle> => {
  const server: Server = createServer(createMiniappHandler(deps));

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.port ?? Number(process.env.MINIAPP_PORT ?? 8090), '0.0.0.0', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

  const baseUrl = deps.baseUrl.replace(/\/$/, '');

  return {
    url: baseUrl,
    port,
    /**
     * Ссылка для кнопки open_app: только одноразовая подпись. Черновик страница
     * забирает сама (GET /app/draft), поэтому URL короткий и не ломается
     * на длинных анкетах.
     */
    buildUrl: (ticket: string) => {
      const params = new URLSearchParams({ t: ticket });
      return `${baseUrl}/app/questions?${params.toString()}`;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

/** Новый пропуск для ссылки на конструктор. */
export const newTicket = (): string => randomBytes(12).toString('hex');
