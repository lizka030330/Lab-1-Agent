/**
 * Вимикач агента (Лаб. 4, крок 06).
 *
 * Прапорець живе в конфігураційному сховищі Vercel — Global Config (до перейменування — Edge Config) —
 * і читається на КОЖЕН запит, тож вимкнути агента можна без деплою. Пакет-клієнт не ставимо: читання —
 * це один GET на endpoint для читання (документація Vercel «Using Global Config»):
 *   GET https://global-config.vercel.com/<id>/item/<key>
 *   Authorization: Bearer <read access token>
 * Рядок підключення Vercel кладе в змінну GLOBAL_CONFIG (старі проєкти — EDGE_CONFIG) у форматі
 *   https://global-config.vercel.com/<id>?token=<token>
 *
 * Правило: вмикає ТІЛЬКИ явне true; сховище недосяжне → вимкнено.
 * Лічильників тут НЕМАЄ: на Hobby сховище дає лише 100 записів на місяць (див. src/budget.ts).
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConfigConnection {
  readonly base: string;
  readonly id: string;
  readonly token: string;
}

export function parseConnection(value: string | undefined): ConfigConnection | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const id = url.pathname.replace(/^\/+|\/+$/g, '');
    const token = url.searchParams.get('token');
    if (!id || !token || id.includes('/')) return null;
    return { base: url.origin, id, token };
  } catch {
    return null;
  }
}

export function connectionFromEnv(env: NodeJS.ProcessEnv = process.env): ConfigConnection | null {
  return parseConnection(env.GLOBAL_CONFIG || env.EDGE_CONFIG);
}

export class FlagStoreError extends Error {
  override readonly name = 'FlagStoreError';
}

export interface ReadOptions {
  readonly conn?: ConfigConnection | null;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

/** Значення ключа; undefined — ключа немає. Будь-який інший збій — FlagStoreError (НЕ глушиться тут). */
export async function readItem(key: string, opts: ReadOptions = {}): Promise<unknown> {
  const conn = opts.conn === undefined ? connectionFromEnv() : opts.conn;
  if (!conn) throw new FlagStoreError('no_connection');
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${conn.base}/${conn.id}/item/${encodeURIComponent(key)}`, {
      headers: { authorization: `Bearer ${conn.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
    });
  } catch (e) {
    throw new FlagStoreError(`unreachable: ${e instanceof Error ? e.name : 'error'}`);
  }
  if (res.status === 404 || res.status === 204) return undefined;
  if (!res.ok) throw new FlagStoreError(`status_${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new FlagStoreError('bad_json');
  }
}

export const FLAG_KEY = 'agentEnabled';
export const LIMITS_KEY = 'limits';

export async function isAgentEnabled(opts: ReadOptions = {}): Promise<boolean> {
  try {
    return (await readItem(FLAG_KEY, opts)) === true;
  } catch {
    return false; // запобіжник, що відкривається при збої, не є запобіжником
  }
}

/** Досяжність сховища — окремо від значення: інакше /api/ready не відрізнить «вимкнено» від «впало». */
export async function probeFlagStore(opts: ReadOptions = {}): Promise<boolean> {
  try {
    await readItem(FLAG_KEY, opts);
    return true;
  } catch {
    return false;
  }
}
