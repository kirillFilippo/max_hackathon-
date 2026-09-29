import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Logger } from '../../logger.js';
import { MEMORY_SNAPSHOT_VERSION, type MemorySnapshot } from '../memory/store.js';

/**
 * Сохранение памяти на диск на время обрыва связи.
 *
 * Если контейнер перезапустят, пока база недоступна, данные не должны пропасть:
 * снимок памяти лежит в файле и поднимается при старте. Как только связь
 * появится и данные уедут в PostgreSQL, файл удаляется — он нужен ровно на
 * время обрыва.
 */
export interface OfflineStateFile {
  path: string;
  /** Есть ли файл со снимком прошлой офлайн-сессии. */
  exists: () => boolean;
  load: () => MemorySnapshot | null;
  save: (snapshot: MemorySnapshot) => void;
  clear: () => void;
}

export const createOfflineStateFile = (filePath: string, logger: Logger): OfflineStateFile => {
  const resolved = path.resolve(filePath);

  return {
    path: resolved,

    exists: () => existsSync(resolved),

    load: () => {
      if (!existsSync(resolved)) return null;
      try {
        const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as MemorySnapshot;
        // Снимок чужого формата не поднимаем: лучше потерять данные обрыва,
        // чем восстановить их криво и потом записать это в базу.
        if (parsed.version !== MEMORY_SNAPSHOT_VERSION) {
          logger.warn(
            `Офлайн-снимок ${resolved} версии ${String(parsed.version)} несовместим `
              + `с текущей (${MEMORY_SNAPSHOT_VERSION}) — оставляю файл без изменений.`,
          );
          return null;
        }
        logger.warn(`Поднимаю данные из офлайн-снимка ${resolved} (база была недоступна при остановке).`);
        return parsed;
      } catch (error) {
        logger.error(`Не удалось прочитать офлайн-снимок ${resolved}`, error);
        return null;
      }
    },

    save: (snapshot) => {
      try {
        mkdirSync(path.dirname(resolved), { recursive: true });
        // Пишем через временный файл: обрыв на записи не испортит снимок.
        const temporary = `${resolved}.tmp`;
        writeFileSync(temporary, JSON.stringify(snapshot), 'utf8');
        renameSync(temporary, resolved);
      } catch (error) {
        logger.warn(`Не удалось сохранить офлайн-снимок ${resolved}`, error);
      }
    },

    clear: () => {
      try {
        rmSync(resolved, { force: true });
      } catch (error) {
        logger.warn(`Не удалось удалить офлайн-снимок ${resolved}`, error);
      }
    },
  };
};
