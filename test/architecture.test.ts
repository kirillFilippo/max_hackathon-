import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { createMemoryRepositories } from '../src/db/memory/index.js';
import type { Db } from '../src/db/pool.js';
import type { Repositories } from '../src/db/repositories/contracts.js';
import { createRepositories } from '../src/db/repositories/index.js';
import { REPOSITORY_SPEC } from '../src/db/resilient/resilientRepositories.js';

/**
 * Архитектурные стражи: проверки, которые дешевле выполнять машиной, чем ревьюером.
 *
 * Здесь живут два правила:
 *  1. payload кнопки собирается только в `bot/callbacks.ts` — это контракт с уже
 *     отправленными сообщениями, формат должен читаться в одном месте (один проход
 *     рефакторинга оставил 21 сайт с рукописными `ev:card:…`, `shop:show:…`);
 *  2. права на событие сравниваются только в `bot/handlers/helpers.ts` — иначе
 *     правило расползается по экранам: один пускает чужого, другой нет.
 */

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const CALLBACKS_FILE = path.join(SRC_DIR, 'bot', 'callbacks.ts');
const HELPERS_FILE = path.join(SRC_DIR, 'bot', 'handlers', 'helpers.ts');

/** Семейства кнопок: `menu`, `ev`, `shop`, `item`, `tpl`, `reg`, `q`, `app`, `faq`, `draft`, `profile`. */
const PAYLOAD_LITERAL =
  /[`'"](?:menu|ev|shop|item|tpl|reg|q|app|faq|draft|profile):[^`'"]*[`'"]/;

/** Сравнение прав на событие: `organizerId === …` или `organizerId !== …`. */
const OWNER_COMPARISON = /organizerId\s*[!=]==?/;

const collectFiles = (dir: string): string[] => {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(full));
    else if (entry.name.endsWith('.ts')) result.push(full);
  }
  return result;
};

/** Строки комментариев пропускаем: в них payload'ы упоминаются как примеры. */
const isCommentLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
};

/** Собирает строки файлов под каталогом, где встречается шаблон. */
const collectMatches = (dir: string, pattern: RegExp, skip: string): string[] => {
  const offenders: string[] = [];
  for (const file of collectFiles(dir)) {
    if (file === skip) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (isCommentLine(line)) return;
      if (pattern.test(line)) {
        offenders.push(`${path.relative(path.dirname(SRC_DIR), file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return offenders;
};

describe('архитектура: payload кнопок', () => {
  it('собирается только в bot/callbacks.ts', () => {
    const offenders = collectMatches(SRC_DIR, PAYLOAD_LITERAL, CALLBACKS_FILE);
    assert.deepEqual(
      offenders,
      [],
      `Payload'ы должны собираться билдерами cbXxx из bot/callbacks.ts:\n${offenders.join('\n')}`,
    );
  });
});

describe('архитектура: права на событие', () => {
  it('сравниваются только в bot/handlers/helpers.ts', () => {
    const offenders = collectMatches(path.join(SRC_DIR, 'bot'), OWNER_COMPARISON, HELPERS_FILE);
    assert.deepEqual(
      offenders,
      [],
      'Права на событие сравниваются только в helpers.ts (isOrganizerOf):\n'
        + offenders.join('\n'),
    );
  });
});

/**
 * Методы без офлайн-фолбэка — по делу: `withLock` держит очередь в процессе бота
 * и в базу не ходит, поэтому переключать его на память нечего.
 */
const METHODS_WITHOUT_FALLBACK = new Set(['withLock']);

const methodsOf = (repo: object): string[] =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(repo)).filter((name) => name !== 'constructor');

/**
 * Слоистость: кто кого не должен импортировать. Правило зависимостей —
 * `bot → services → db → domain` (см. §2 гайда): обратный импорт ломает и
 * тестируемость, и заменяемость хранилища.
 */
const LAYER_RULES: Record<string, string[]> = {
  domain: ['db', 'bot', 'services', 'miniapp', 'app'],
  db: ['bot', 'services', 'miniapp', 'app'],
  services: ['bot', 'miniapp', 'app'],
  miniapp: ['bot', 'services', 'app'],
};

/** Слой файла: первый каталог под `src/` или `root` для файлов верхнего уровня. */
const layerOf = (file: string): string => {
  const parts = path.relative(SRC_DIR, file).split(path.sep);
  return parts.length === 1 ? 'root' : parts[0]!;
};

describe('архитектура: слои', () => {
  it('импорты идут только вниз по слоям', () => {    const violations: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      const forbidden = LAYER_RULES[layerOf(file)];
      if (!forbidden) continue;
      const body = readFileSync(file, 'utf8');
      for (const match of body.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const target = path.normalize(path.join(path.dirname(file), match[1]!));
        const targetLayer = layerOf(target);
        if (!forbidden.includes(targetLayer)) continue;
        const from = path.relative(path.dirname(SRC_DIR), file);
        const to = path.relative(path.dirname(SRC_DIR), target);
        violations.push(`${from} → ${to} (${layerOf(file)} → ${targetLayer})`);
      }
    }
    assert.deepEqual(violations, [], `Импорты идут вверх по слоям:\n${violations.join('\n')}`);
  });

  /**
   * Фасад — это файл `foo.ts` рядом с каталогом `foo/`, который целиком
   * реэкспортирует этот каталог. Живёт он только ради старых путей импорта;
   * таких в проекте было пять. Просто соседство с каталогом фасадом не является:
   * `src/app.ts` — композиционный корень рядом с `src/app/*`.
   */
  it('нет файлов-фасадов рядом с одноимённым каталогом', () => {
    const facades: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      if (path.basename(file) === 'index.ts') continue;
      const dir = file.replace(/\.ts$/, '');
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      const name = path.basename(file, '.ts');
      const body = readFileSync(file, 'utf8');
      if (new RegExp(`export\\s+\\*\\s+from\\s+['"]\\./${name}/`).test(body)) {
        facades.push(path.relative(path.dirname(SRC_DIR), file));
      }
    }
    assert.deepEqual(facades, [], `Фасады ради старых путей импорта:\n${facades.join('\n')}`);
  });
});

describe('архитектура: служебные скрипты', () => {
  /**
   * Скрипты деплоя тестами не покрыть: они ходят по SSH и поднимают контейнеры.
   * Но синтаксис проверить можно — опечатка в них иначе находится уже на узле.
   */
  it('разбираются оболочкой (bash -n)', () => {
    const scripts = ['deploy.sh', 'deploy-home.sh', 'setup-vps.sh', 'bootstrap-void.sh'];
    const broken: string[] = [];
    for (const name of scripts) {
      const file = path.join(path.dirname(SRC_DIR), 'scripts', name);
      try {
        execFileSync('bash', ['-n', file], { stdio: 'pipe' });
      } catch (error) {
        const stderr = String((error as { stderr?: Buffer }).stderr ?? error).trim();
        broken.push(`${name}: ${stderr}`);
      }
    }
    assert.deepEqual(broken, [], `Скрипты не проходят bash -n:\n${broken.join('\n')}`);
  });
});

describe('архитектура: хранилище', () => {
  // Экземпляры нужны только чтобы перечислить методы: запросов они не делают.
  const pg = createRepositories({} as Db);
  const memory = createMemoryRepositories();

  it('SPEC описывает каждый метод репозитория', () => {
    const missing: string[] = [];
    for (const name of Object.keys(pg) as Array<keyof Repositories>) {
      const covered = new Set(Object.keys(REPOSITORY_SPEC[name]));
      for (const method of methodsOf(pg[name] as object)) {
        if (covered.has(method) || METHODS_WITHOUT_FALLBACK.has(method)) continue;
        missing.push(`${name}.${method}`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      'У методов нет записи в REPOSITORY_SPEC — при обрыве связи они уйдут в базу и упадут:\n'
        + missing.join('\n'),
    );
  });

  it('память повторяет набор методов PostgreSQL', () => {
    const diff: string[] = [];
    for (const name of Object.keys(pg) as Array<keyof Repositories>) {
      const inPg = new Set(methodsOf(pg[name] as object));
      const inMemory = new Set(methodsOf(memory[name] as object));
      for (const method of inPg) {
        if (!inMemory.has(method)) diff.push(`${name}.${method}: есть в PostgreSQL, нет в памяти`);
      }
      for (const method of inMemory) {
        if (!inPg.has(method)) diff.push(`${name}.${method}: есть в памяти, нет в PostgreSQL`);
      }
    }
    assert.deepEqual(diff, [], `Реализации хранилища разошлись:\n${diff.join('\n')}`);
  });
});
