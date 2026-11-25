import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as health } from '../../app/api/health/route';
import { GET as ready } from '../../app/api/ready/route';

afterEach(() => vi.unstubAllEnvs());

describe('/api/health і /api/ready не викликають модель', () => {
  it('health віддає версію', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234');
    expect(await (await health()).json()).toMatchObject({ status: 'ok', commit: 'abc1234' });
  });
  it('ready без сховищ і ключа — 503 з поіменними перевірками, значень ключів у відповіді немає', async () => {
    for (const k of ['GLOBAL_CONFIG', 'EDGE_CONFIG', 'UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'GOOGLE_GENERATIVE_AI_API_KEY']) vi.stubEnv(k, '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await ready();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, checks: { modelKey: false, flagStore: false, agentEnabled: false, budgetStore: false, budget: false } });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
