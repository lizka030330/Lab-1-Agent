/**
 * GET /api/ready (Лаб. 4, крок 06) — «чи можна давати мені запит»: ключ моделі на місці, сховище прапорця
 * досяжне, прапорець увімкнено, сховище лічильників відповідає і добовий бюджет не вичерпано.
 * Модель НЕ викликається. Значення ключів у відповідь не потрапляють — лише true/false.
 */
import { checkTokens, DEFAULT_LIMITS, mergeLimits, storeFromEnv } from '../../../src/budget';
import { isAgentEnabled, LIMITS_KEY, probeFlagStore, readItem } from '../../../src/flags';
import { json } from '../../../src/http';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const store = storeFromEnv();
  let budget = false;
  if (store) {
    try {
      const limits = mergeLimits(DEFAULT_LIMITS, await readItem(LIMITS_KEY).catch(() => undefined));
      budget = (await checkTokens(store, limits)).ok;
    } catch {
      budget = false;
    }
  }
  const checks = {
    modelKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    flagStore: await probeFlagStore(),
    agentEnabled: await isAgentEnabled(),
    budgetStore: Boolean(store),
    budget,
  };
  const ok = Object.values(checks).every(Boolean);
  return json({ ok, checks }, ok ? 200 : 503);
}
