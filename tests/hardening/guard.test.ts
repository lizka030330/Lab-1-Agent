import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, memoryStore, recordUsage, type CounterStore } from '../../src/budget';
import { guard, type GuardDeps } from '../../src/guard';

const deps = (over: Partial<GuardDeps> = {}): GuardDeps => ({
  enabled: async () => true,
  limits: async () => DEFAULT_LIMITS,
  store: memoryStore(),
  now: () => new Date('2026-11-25T10:00:00Z'),
  ...over,
});

describe('guard', () => {
  it('прапорець вимкнено → 503 agent_disabled, лічильники не чіпаються', async () => {
    const store = memoryStore();
    const g = await guard(['vision'], deps({ enabled: async () => false, store }));
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.response.status).toBe(503);
      expect(await g.response.json()).toMatchObject({ error: 'agent_disabled' });
    }
    expect(store.dump()).toEqual({});
  });
  it('немає сховища лічильників → 503, а не «без обліку»', async () => {
    const g = await guard(['vision'], deps({ store: null }));
    expect(!g.ok && g.response.status).toBe(503);
  });
  it('сховище впало → 503 budget_store_unavailable', async () => {
    const broken: CounterStore = { incr: async () => { throw new Error('x'); }, get: async () => [0, 0] };
    const g = await guard(['vision'], deps({ store: broken }));
    expect(!g.ok && g.response.status).toBe(503);
  });
  it('межа → 429 з причиною і Retry-After', async () => {
    const d = deps({ limits: async () => ({ ...DEFAULT_LIMITS, requestsPerDay: 1 }) });
    expect((await guard(['vision'], d)).ok).toBe(true);
    const g = await guard(['vision'], d);
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.response.status).toBe(429);
      expect(g.response.headers.get('retry-after')).toBe(String(14 * 3600));
      expect(await g.response.json()).toMatchObject({ ok: false, error: 'budget_exhausted', reason: 'requests_per_day' });
    }
  });
  it('вичерпані токени → 429 ще до збільшення лічильника запитів', async () => {
    const store = memoryStore();
    const d = deps({ store, limits: async () => ({ ...DEFAULT_LIMITS, outputTokensPerDay: 10 }) });
    await recordUsage(store, { inputTokens: 1, outputTokens: 10 }, new Date('2026-11-25T10:00:00Z'));
    const g = await guard(['agent'], d);
    expect(!g.ok && g.response.status).toBe(429);
    expect(store.dump()['lab4:d:2026-11-25:req']).toBeUndefined();
  });
});
