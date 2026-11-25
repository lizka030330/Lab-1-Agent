/**
 * Стеля витрат і обмеження частоти НА РІВНІ ЗАСТОСУНКУ (Лаб. 4, крок 06).
 *
 * Чому в коді: Spend Management на Hobby — N/A, а правило WAF бачить IP, а не мою квоту Gemini.
 * Чому не Map у модулі: інстансів функції може бути багато, кожен рахував би своє.
 * Чому не Global Config: там 100 записів на місяць — лічильник вичерпав би їх за хвилини.
 * Тому лічильники — у Upstash Redis (REST), додавання — АТОМАРНЕ: INCRBY усередині транзакції
 * POST <url>/multi-exec з тілом [["INCRBY", key, n], ["EXPIRE", key, ttl], ...] (документація Upstash «REST API»).
 *
 * Дві різні перевірки:
 *   admit()        — ДО виклику: атомарно +1 до лічильників запитів (за день, за хвилину, окремо TTS/STT)
 *                    і порівняння НОВОГО значення з межею. Запити в польоті перевищити межу не можуть.
 *   checkTokens()  — ДО виклику: токени вже витрачені за день < межі. recordUsage() — ПІСЛЯ виклику.
 *                    Перевищення по токенах можливе на «запити в польоті × токени одного запиту» —
 *                    тому межа нижча за квоту з AI Studio.
 * Відхилена спроба теж збільшує лічильник запитів (рахуємо спроби) — це консервативно, і так задумано.
 */
export type Feature = 'agent' | 'vision' | 'tts' | 'stt';

export interface Limits {
  readonly requestsPerDay: number;
  readonly requestsPerMinute: number;
  readonly inputTokensPerDay: number;
  readonly outputTokensPerDay: number;
  readonly ttsPerMinute: number;
  readonly ttsPerDay: number;
  readonly sttPerMinute: number;
  readonly sttPerDay: number;
}

/**
 * Квота мого ключа (AI Studio → Rate Limit, Tier 1, переписано 25.11.2026):
 * Flash 1K RPM / 10K RPD / 2M TPM; TTS 10 RPM / 100 RPD; Transcribe 10 RPM / 100 RPD.
 * Мої межі — помітно нижчі, бо це демонстрація, а не продукт із користувачами.
 */
export const DEFAULT_LIMITS: Limits = {
  requestsPerDay: 300,
  requestsPerMinute: 20,
  inputTokensPerDay: 1_000_000,
  outputTokensPerDay: 100_000,
  ttsPerMinute: 5,
  ttsPerDay: 50,
  sttPerMinute: 5,
  sttPerDay: 50,
};

/** Перевизначення з конфігураційного сховища (лише числа ≥ 0 з відомими ключами) — щоб звузити межу без деплою. */
export function mergeLimits(base: Limits, override: unknown): Limits {
  if (!override || typeof override !== 'object') return base;
  const out: Record<string, number> = { ...base };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (k in base && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out as unknown as Limits;
}

/** [ключ, на скільки збільшити, TTL у секундах] */
export type IncrOp = readonly [key: string, by: number, ttlSec: number];

export interface CounterStore {
  /** Атомарно збільшує всі лічильники і повертає НОВІ значення в тому ж порядку. */
  incr(ops: readonly IncrOp[]): Promise<number[]>;
  /** Поточні значення (відсутній ключ = 0). */
  get(keys: readonly string[]): Promise<number[]>;
}

export class CounterStoreError extends Error {
  override readonly name = 'CounterStoreError';
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function upstashStore(url: string, token: string, fetchImpl: FetchLike = fetch): CounterStore {
  const base = url.replace(/\/+$/, '');
  async function call(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(2000),
      });
    } catch (e) {
      throw new CounterStoreError(`unreachable: ${e instanceof Error ? e.name : 'error'}`);
    }
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw new CounterStoreError(`status_${res.status}`);
    return data;
  }
  function results(data: unknown, n: number): unknown[] {
    if (!Array.isArray(data) || data.length !== n) throw new CounterStoreError('bad_response');
    return data.map((item: { result?: unknown; error?: string }) => {
      if (item?.error) throw new CounterStoreError(item.error);
      return item?.result;
    });
  }
  return {
    async incr(ops) {
      const cmds = ops.flatMap(([k, by, ttl]) => [['INCRBY', k, String(by)], ['EXPIRE', k, String(ttl)]]);
      const r = results(await call('/multi-exec', cmds), cmds.length);
      return ops.map((_, i) => Number(r[i * 2]));
    },
    async get(keys) {
      if (keys.length === 0) return [];
      const [values] = results(await call('/pipeline', [['MGET', ...keys]]), 1) as [unknown[]];
      return (values ?? []).map((v) => (v == null ? 0 : Number(v)));
    },
  };
}

export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): CounterStore | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? upstashStore(url, token) : null;
}

/** Для тестів: атомарність тут тривіальна — JS однопотоковий. */
export function memoryStore(): CounterStore & { dump(): Record<string, number> } {
  const m = new Map<string, number>();
  return {
    async incr(ops) {
      return ops.map(([k, by]) => {
        const v = (m.get(k) ?? 0) + by;
        m.set(k, v);
        return v;
      });
    },
    async get(keys) {
      return keys.map((k) => m.get(k) ?? 0);
    },
    dump: () => Object.fromEntries(m),
  };
}

const DAY = 2 * 24 * 3600;
const MIN = 120;

export function keysFor(now: Date) {
  const day = now.toISOString().slice(0, 10);
  const minute = now.toISOString().slice(0, 16);
  return {
    requestsDay: `lab4:d:${day}:req`,
    requestsMin: `lab4:m:${minute}:req`,
    inDay: `lab4:d:${day}:in`,
    outDay: `lab4:d:${day}:out`,
    ttsDay: `lab4:d:${day}:tts`,
    ttsMin: `lab4:m:${minute}:tts`,
    sttDay: `lab4:d:${day}:stt`,
    sttMin: `lab4:m:${minute}:stt`,
  };
}

export type Verdict = { ok: true } | { ok: false; error: 'budget_exhausted' | 'rate_limited'; reason: string; retryAfterSec: number };

function secondsToNextMinute(now: Date): number {
  return 60 - now.getUTCSeconds();
}
function secondsToNextDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

/** Токени за день — до виклику. */
export async function checkTokens(store: CounterStore, limits: Limits, now = new Date()): Promise<Verdict> {
  const k = keysFor(now);
  const [inT, outT] = await store.get([k.inDay, k.outDay]);
  if ((inT ?? 0) >= limits.inputTokensPerDay) return { ok: false, error: 'budget_exhausted', reason: 'input_tokens_per_day', retryAfterSec: secondsToNextDay(now) };
  if ((outT ?? 0) >= limits.outputTokensPerDay) return { ok: false, error: 'budget_exhausted', reason: 'output_tokens_per_day', retryAfterSec: secondsToNextDay(now) };
  return { ok: true };
}

/** Запити — атомарно «+1 і порівняти нове значення». */
export async function admit(store: CounterStore, limits: Limits, features: readonly Feature[], now = new Date()): Promise<Verdict> {
  const k = keysFor(now);
  const checks: Array<{ op: IncrOp; limit: number; reason: string; perDay: boolean }> = [
    { op: [k.requestsDay, 1, DAY], limit: limits.requestsPerDay, reason: 'requests_per_day', perDay: true },
    { op: [k.requestsMin, 1, MIN], limit: limits.requestsPerMinute, reason: 'requests_per_minute', perDay: false },
  ];
  if (features.includes('tts')) {
    checks.push({ op: [k.ttsDay, 1, DAY], limit: limits.ttsPerDay, reason: 'tts_per_day', perDay: true });
    checks.push({ op: [k.ttsMin, 1, MIN], limit: limits.ttsPerMinute, reason: 'tts_per_minute', perDay: false });
  }
  if (features.includes('stt')) {
    checks.push({ op: [k.sttDay, 1, DAY], limit: limits.sttPerDay, reason: 'stt_per_day', perDay: true });
    checks.push({ op: [k.sttMin, 1, MIN], limit: limits.sttPerMinute, reason: 'stt_per_minute', perDay: false });
  }
  const values = await store.incr(checks.map((c) => c.op));
  for (const [i, c] of checks.entries()) {
    if ((values[i] ?? 0) > c.limit) {
      return c.perDay
        ? { ok: false, error: 'budget_exhausted', reason: c.reason, retryAfterSec: secondsToNextDay(now) }
        : { ok: false, error: 'rate_limited', reason: c.reason, retryAfterSec: secondsToNextMinute(now) };
    }
  }
  return { ok: true };
}

/** Після прогону: агентний цикл звітує totalUsage; поля number | undefined → ?? 0. */
export async function recordUsage(store: CounterStore, usage: { inputTokens?: number | undefined; outputTokens?: number | undefined }, now = new Date()): Promise<void> {
  const k = keysFor(now);
  await store.incr([
    [k.inDay, usage.inputTokens ?? 0, DAY],
    [k.outDay, usage.outputTokens ?? 0, DAY],
  ]);
}
