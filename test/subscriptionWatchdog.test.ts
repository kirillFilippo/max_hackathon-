import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ensureSubscription,
  startSubscriptionWatchdog,
  type SubscriptionApi,
  type SubscriptionLike,
} from '../src/bot/subscriptionWatchdog.js';
import { createLogger } from '../src/logger.js';

const silent = createLogger('error');
const URL = 'https://dosug.example/max/webhook';

interface FakeApi extends SubscriptionApi {
  subscribed: string[];
  list: SubscriptionLike[];
  failList: boolean;
  failSubscribe: boolean;
}

const fakeApi = (list: SubscriptionLike[] = []): FakeApi => ({
  list,
  subscribed: [],
  failList: false,
  failSubscribe: false,
  async getSubscriptions() {
    if (this.failList) throw new Error('сеть недоступна');
    return this.list;
  },
  async subscribe(url: string) {
    if (this.failSubscribe) throw new Error('сеть недоступна');
    this.subscribed.push(url);
    this.list = [...this.list, { url }];
    return { success: true };
  },
});

describe('Сторож подписки на вебхук', () => {
  it('ничего не делает, когда подписка на месте', async () => {
    const api = fakeApi([{ url: URL }]);
    const state = await ensureSubscription({ api, logger: silent, url: URL, secret: 's' });

    assert.equal(state, 'ok');
    assert.deepEqual(api.subscribed, []);
  });

  it('оформляет подписку заново, если MAX её потерял', async () => {
    const api = fakeApi([{ url: 'https://other.example/webhook' }]);
    const state = await ensureSubscription({ api, logger: silent, url: URL, secret: 's' });

    assert.equal(state, 'restored');
    assert.deepEqual(api.subscribed, [URL]);
    // Следующая проверка уже видит подписку и не дублирует её.
    assert.equal(await ensureSubscription({ api, logger: silent, url: URL, secret: 's' }), 'ok');
    assert.equal(api.subscribed.length, 1);
  });

  it('не падает при обрыве связи и повторяет на следующем тике', async () => {
    const api = fakeApi([{ url: URL }]);
    api.failList = true;
    assert.equal(await ensureSubscription({ api, logger: silent, url: URL }), 'failed');

    api.failList = false;
    api.list = [];
    assert.equal(await ensureSubscription({ api, logger: silent, url: URL }), 'restored');
  });

  it('сообщает об ошибке, если подписку не удалось оформить', async () => {
    const api = fakeApi([]);
    api.failSubscribe = true;
    assert.equal(await ensureSubscription({ api, logger: silent, url: URL }), 'failed');
  });

  it('периодическая проверка восстанавливает подписку и останавливается', async () => {
    const api = fakeApi([]);
    const watchdog = startSubscriptionWatchdog({
      api,
      logger: silent,
      url: URL,
      secret: 's',
      intervalMs: 1_000,
    });

    assert.equal(await watchdog.check(), 'restored');
    assert.deepEqual(api.subscribed, [URL]);
    watchdog.stop();
  });
});
