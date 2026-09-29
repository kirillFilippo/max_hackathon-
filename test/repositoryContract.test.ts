import { after, before } from 'node:test';

import { createMemoryRepositories } from '../src/db/memory/index.js';
import { startHarness, type Harness } from './support.js';
import { describeRepositoryContract } from './repositoryContract.js';

/**
 * Одна сюита — две реализации. Так расхождение между памятью и PostgreSQL
 * ловится сразу, а не при обрыве связи: контракт у них обязан быть общим
 * (см. инвариант в `docs/DEVELOPER-GUIDE.md`).
 */

// Память: каждый прогон получает чистое хранилище — сбрасывать нечего.
describeRepositoryContract('память', async () => createMemoryRepositories());

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.stop();
});

// PostgreSQL: перед каждым тестом чистим таблицы, но используем тот же пул.
describeRepositoryContract('PostgreSQL', async () => {
  await harness.reset();
  return harness.repos;
});
