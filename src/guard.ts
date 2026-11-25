/**
 * Брама перед будь-яким викликом моделі (Лаб. 4, крок 06). Порядок:
 *   1) вимикач (Global Config) → 503 agent_disabled;
 *   2) сховище лічильників є і відповідає → інакше 503 budget_store_unavailable (без обліку — без моделі);
 *   3) токени за день → 429 budget_exhausted;
 *   4) запити (атомарно) → 429 budget_exhausted | rate_limited.
 * Відмова — явна: код стану, error, reason, Retry-After. Не тихий порожній результат.
 */
import { admit, checkTokens, CounterStoreError, DEFAULT_LIMITS, mergeLimits, storeFromEnv, type CounterStore, type Feature, type Limits } from './budget';
import { isAgentEnabled, LIMITS_KEY, readItem } from './flags';
import { json } from './http';

const MESSAGES = {
  budget_exhausted: (s: number) => `Денний ліміт демонстрації вичерпано. Спробуйте через ${Math.ceil(s / 3600)} год.`,
  rate_limited: (s: number) => `Забагато запитів за хвилину. Спробуйте через ${s} с.`,
} as const;

export interface GuardDeps {
  readonly enabled: () => Promise<boolean>;
  readonly limits: () => Promise<Limits>;
  readonly store: CounterStore | null;
  readonly now?: () => Date;
}

export function defaultDeps(): GuardDeps {
  return {
    enabled: () => isAgentEnabled(),
    limits: async () => {
      try {
        return mergeLimits(DEFAULT_LIMITS, await readItem(LIMITS_KEY));
      } catch {
        return DEFAULT_LIMITS;
      }
    },
    store: storeFromEnv(),
  };
}

export type GuardResult = { ok: true; store: CounterStore; limits: Limits } | { ok: false; response: Response };

export async function guard(features: readonly Feature[], deps: GuardDeps = defaultDeps()): Promise<GuardResult> {
  if (!(await deps.enabled())) {
    return { ok: false, response: json({ ok: false, error: 'agent_disabled', reason: 'flag_off_or_store_unreachable', message: 'Асистент тимчасово вимкнений. Спробуйте пізніше.' }, 503) };
  }
  if (!deps.store) {
    return { ok: false, response: json({ ok: false, error: 'budget_store_unavailable', reason: 'not_configured', message: 'Облік витрат недоступний — запит не виконано.' }, 503) };
  }
  const now = deps.now?.() ?? new Date();
  const limits = await deps.limits();
  try {
    // ПО ЧЕРЗІ: якщо токени вичерпано, admit() не викликається і лічильник запитів не росте
    for (const step of [() => checkTokens(deps.store!, limits, now), () => admit(deps.store!, limits, features, now)]) {
      const verdict = await step();
      if (!verdict.ok) {
        return {
          ok: false,
          response: json({ ok: false, error: verdict.error, reason: verdict.reason, message: MESSAGES[verdict.error](verdict.retryAfterSec) }, 429, { 'retry-after': String(verdict.retryAfterSec) }),
        };
      }
    }
  } catch (e) {
    const reason = e instanceof CounterStoreError ? e.message : 'error';
    return { ok: false, response: json({ ok: false, error: 'budget_store_unavailable', reason, message: 'Облік витрат недоступний — запит не виконано.' }, 503) };
  }
  return { ok: true, store: deps.store, limits };
}
