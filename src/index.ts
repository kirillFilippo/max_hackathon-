/**
 * Точка входа бота-ассистента организатора досуговых мероприятий в MAX.
 *
 * Запуск:
 *   1. cp .env.example .env и укажите BOT_TOKEN;
 *   2. npm install && npm run dev   (или docker compose up --build).
 */
import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';
import { createLogger } from './logger.js';
import { reexecWithCaCert } from './tls.js';

loadEnvFile();

const config = loadConfig();
// Часовой пояс процесса — чтобы логи и любые локальные даты совпадали с APP_TZ.
process.env.TZ = config.appTz;

const logger = createLogger(config.logLevel);

const main = async (): Promise<void> => {
  // Если рядом лежит корневой сертификат, а переменная ещё не выставлена —
  // перезапускаемся с ним (Node читает NODE_EXTRA_CA_CERTS только при старте).
  if (await reexecWithCaCert(logger)) return;

  const app = await createApp(config, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Получен ${signal}, останавливаемся`);
    await app.stop().catch((error) => logger.error('Ошибка при остановке', error));
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.start();
};

main().catch((error) => {
  logger.error('Не удалось запустить бота', error);
  process.exitCode = 1;
});
