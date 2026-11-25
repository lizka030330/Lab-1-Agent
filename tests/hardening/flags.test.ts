import { describe, expect, it } from 'vitest';

import { FlagStoreError, isAgentEnabled, parseConnection, probeFlagStore, readItem, type FetchLike } from '../../src/flags';

const conn = parseConnection('https://global-config.vercel.com/ecfg_abc?token=tok-123')!;
const reply = (status: number, body?: unknown): FetchLike => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('рядок підключення Global Config', () => {
  it('розбирає id і токен', () => {
    expect(conn).toEqual({ base: 'https://global-config.vercel.com', id: 'ecfg_abc', token: 'tok-123' });
  });
  it('без токена або id — null, а не напівзаповнене підключення', () => {
    expect(parseConnection('https://global-config.vercel.com/ecfg_abc')).toBeNull();
    expect(parseConnection('https://global-config.vercel.com/?token=x')).toBeNull();
    expect(parseConnection('не url')).toBeNull();
    expect(parseConnection(undefined)).toBeNull();
  });
});

describe('readItem', () => {
  it('йде на /<id>/item/<key> з Bearer-токеном', async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const f: FetchLike = async (url, init) => {
      seen = { url, auth: new Headers(init?.headers).get('authorization') };
      return new Response('true', { status: 200 });
    };
    expect(await readItem('agentEnabled', { conn, fetchImpl: f })).toBe(true);
    expect(seen).toEqual({ url: 'https://global-config.vercel.com/ecfg_abc/item/agentEnabled', auth: 'Bearer tok-123' });
  });
  it('404 — ключа немає (undefined), 500 — помилка сховища', async () => {
    expect(await readItem('x', { conn, fetchImpl: reply(404) })).toBeUndefined();
    await expect(readItem('x', { conn, fetchImpl: reply(500) })).rejects.toBeInstanceOf(FlagStoreError);
  });
  it('без підключення — помилка, мережі не торкається', async () => {
    await expect(readItem('x', { conn: null, fetchImpl: () => { throw new Error('не мав кликати'); } })).rejects.toThrow('no_connection');
  });
});

describe('вимикач', () => {
  it('вмикає ЛИШЕ явне true', async () => {
    expect(await isAgentEnabled({ conn, fetchImpl: reply(200, true) })).toBe(true);
    for (const v of [false, 'true', 1, null, { on: true }]) {
      expect(await isAgentEnabled({ conn, fetchImpl: reply(200, v) })).toBe(false);
    }
    expect(await isAgentEnabled({ conn, fetchImpl: reply(404) })).toBe(false);
  });
  it('недосяжне сховище = вимкнено', async () => {
    expect(await isAgentEnabled({ conn, fetchImpl: async () => { throw new TypeError('fetch failed'); } })).toBe(false);
    expect(await isAgentEnabled({ conn: null })).toBe(false);
  });
  it('probe відрізняє «вимкнено» від «впало»', async () => {
    expect(await probeFlagStore({ conn, fetchImpl: reply(200, false) })).toBe(true);
    expect(await probeFlagStore({ conn, fetchImpl: reply(503) })).toBe(false);
  });
});
