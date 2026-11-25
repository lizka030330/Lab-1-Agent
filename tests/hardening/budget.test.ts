import { describe, expect, it } from 'vitest';

import { admit, checkTokens, DEFAULT_LIMITS, keysFor, memoryStore, mergeLimits, recordUsage, upstashStore, type Limits } from '../../src/budget';

const now = new Date('2026-11-25T21:30:15Z');
const tiny: Limits = { ...DEFAULT_LIMITS, requestsPerDay: 2, requestsPerMinute: 10, ttsPerMinute: 1, ttsPerDay: 10, inputTokensPerDay: 100, outputTokensPerDay: 50 };

describe('admit — атомарне «+1 і порівняти»', () => {
  it('третій запит за день — 429 budget_exhausted до наступної доби', async () => {
    const s = memoryStore();
    expect((await admit(s, tiny, ['vision'], now)).ok).toBe(true);
    expect((await admit(s, tiny, ['vision'], now)).ok).toBe(true);
    const v = await admit(s, tiny, ['vision'], now);
    expect(v).toMatchObject({ ok: false, error: 'budget_exhausted', reason: 'requests_per_day' });
    if (!v.ok) expect(v.retryAfterSec).toBe(2 * 3600 + 29 * 60 + 45);
  });
  it('TTS має власну хвилинну межу', async () => {
    const s = memoryStore();
    expect((await admit(s, tiny, ['vision', 'tts'], now)).ok).toBe(true);
    const v = await admit(s, tiny, ['vision', 'tts'], now);
    expect(v).toMatchObject({ ok: false, error: 'rate_limited', reason: 'tts_per_minute', retryAfterSec: 45 });
  });
  it('нова хвилина — новий лічильник хвилини', async () => {
    const s = memoryStore();
    await admit(s, tiny, ['tts'], now);
    expect((await admit(s, { ...tiny, requestsPerDay: 99 }, ['tts'], new Date('2026-11-25T21:31:00Z'))).ok).toBe(true);
  });
});

describe('токени', () => {
  it('після recordUsage понад межу — наступний запит відхилено ДО виклику моделі', async () => {
    const s = memoryStore();
    expect((await checkTokens(s, tiny, now)).ok).toBe(true);
    await recordUsage(s, { inputTokens: 120, outputTokens: undefined }, now);
    expect(await checkTokens(s, tiny, now)).toMatchObject({ ok: false, reason: 'input_tokens_per_day' });
    expect(s.dump()[keysFor(now).outDay]).toBe(0); // undefined → 0, а не NaN
  });
});

describe('mergeLimits', () => {
  it('бере лише відомі невідʼємні числа', () => {
    const m = mergeLimits(DEFAULT_LIMITS, { requestsPerDay: 1, ttsPerDay: -5, evil: 9, inputTokensPerDay: '7' });
    expect(m.requestsPerDay).toBe(1);
    expect(m.ttsPerDay).toBe(DEFAULT_LIMITS.ttsPerDay);
    expect(m.inputTokensPerDay).toBe(DEFAULT_LIMITS.inputTokensPerDay);
    expect('evil' in m).toBe(false);
  });
});

describe('upstashStore — форма запитів REST', () => {
  it('incr: одна транзакція /multi-exec з INCRBY+EXPIRE на кожен ключ', async () => {
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    const store = upstashStore('https://x.upstash.io/', 'T', async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify([{ result: 3 }, { result: 1 }, { result: 7 }, { result: 1 }]), { status: 200 });
    });
    expect(await store.incr([['a', 1, 60], ['b', 5, 120]])).toEqual([3, 7]);
    expect(calls).toEqual([{ url: 'https://x.upstash.io/multi-exec', auth: 'Bearer T', body: [['INCRBY', 'a', '1'], ['EXPIRE', 'a', '60'], ['INCRBY', 'b', '5'], ['EXPIRE', 'b', '120']] }]);
  });
  it('get: MGET, відсутні ключі = 0', async () => {
    const store = upstashStore('https://x.upstash.io', 'T', async () => new Response(JSON.stringify([{ result: ['4', null] }]), { status: 200 }));
    expect(await store.get(['a', 'b'])).toEqual([4, 0]);
  });
  it('помилка команди або 401 — виняток, а не нулі', async () => {
    const bad = upstashStore('https://x.upstash.io', 'T', async () => new Response(JSON.stringify([{ error: 'ERR' }, { result: 1 }]), { status: 200 }));
    await expect(bad.incr([['a', 1, 60]])).rejects.toThrow('ERR');
    const denied = upstashStore('https://x.upstash.io', 'T', async () => new Response('{"error":"Unauthorized"}', { status: 401 }));
    await expect(denied.get(['a'])).rejects.toThrow('status_401');
  });
});
