/**
 * Circuit breaker фабрики (Лаб. 3, крок 03) — шар харнеса.
 * Стани за Фаулером («CircuitBreaker», 06.03.2014): closed — пропускаємо задачі; open — не пропускаємо нічого;
 * half-open — рівно одна пробна задача. Патерн про виклики віддалених служб; до черги агента я застосовую
 * його за аналогією — це моє інженерне рішення, а не усталена практика (docs/lab3/stop.md).
 *
 * Стан живе у файлі (.harness/breaker.json), а не в змінній процесу: інакше кожен запуск черги
 * починався б closed і брейкер не спрацював би ніколи.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface Breaker {
  readonly state: BreakerState;
  /** Однакових відмов підряд (за `lastFailure`). */
  readonly sameFails: number;
  /** Задач підряд без зеленого acceptance — «немає прогресу». */
  readonly noProgress: number;
  readonly lastFailure: string | null;
  readonly openedAt: string | null;
  /** Чому відкрився — людською мовою, для журналу. */
  readonly trip: string | null;
  /** Перепочинок поточного open; після провальної пробної задачі подвоюється. */
  readonly cooldownMin: number;
  /** half-open: пробну задачу вже видано — другої не даємо, доки не прийде результат. */
  readonly probeTaken: boolean;
}

/** Результат однієї задачі очима брейкера. */
export interface Outcome {
  /** Задача зелена: acceptance пройдено. */
  readonly ok: boolean;
  /** Клас відмови: timeout, quota, agent_failed, budget_or_turns, provider_error, step_limit… */
  readonly failure?: string;
}

/** Умови спрацювання — мої, під цю фабрику (обґрунтування — docs/lab3/stop.md). */
export const RULES = {
  /** однакових відмов підряд */
  sameFailures: 3,
  /** задач підряд без прогресу (будь-які відмови) */
  noProgress: 5,
  /** відмова провайдера за квотою (HTTP 429) — відкриває одразу: далі буде те саме */
  openOnQuota: true,
  /** перепочинок після першого open, хв */
  cooldownMin: 30,
  /** стеля перепочинку після повторних провалів пробної задачі, хв */
  maxCooldownMin: 240,
} as const;

export const BREAKER_FILE = '.harness/breaker.json';

export const CLOSED: Breaker = {
  state: 'closed', sameFails: 0, noProgress: 0, lastFailure: null, openedAt: null, trip: null,
  cooldownMin: RULES.cooldownMin, probeTaken: false,
};

export function load(file = BREAKER_FILE): Breaker {
  if (!existsSync(file)) return CLOSED;
  return { ...CLOSED, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Breaker>) };
}

export function save(b: Breaker, file = BREAKER_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(b, null, 2)}\n`, 'utf8');
}

export interface Decision {
  readonly allow: boolean;
  readonly probe: boolean;
  readonly why: string;
}

/** Чисте рішення: чи можна взяти наступну задачу. Повертає і новий стан (half-open видає пробу). */
export function decide(b: Breaker, now: Date): { decision: Decision; next: Breaker } {
  if (b.state === 'closed') return { decision: { allow: true, probe: false, why: 'closed' }, next: b };
  if (b.state === 'half-open') {
    // рівно одна пробна задача: поки її результату немає — нікого не пускаємо
    if (b.probeTaken) return { decision: { allow: false, probe: false, why: 'half-open: пробна задача вже йде' }, next: b };
    return { decision: { allow: true, probe: true, why: 'half-open: пробна задача' }, next: { ...b, probeTaken: true } };
  }
  const waitedMin = (now.getTime() - Date.parse(b.openedAt ?? now.toISOString())) / 60_000;
  if (waitedMin < b.cooldownMin) {
    const left = Math.ceil(b.cooldownMin - waitedMin);
    return { decision: { allow: false, probe: false, why: `open (${b.trip}); перепочинок ще ${left} хв` }, next: b };
  }
  return {
    decision: { allow: true, probe: true, why: `half-open після ${b.cooldownMin} хв перепочинку: пробна задача` },
    next: { ...b, state: 'half-open', probeTaken: true },
  };
}

/** Чистий перехід після результату задачі. */
export function apply(b: Breaker, o: Outcome, now: Date): Breaker {
  if (o.ok) return CLOSED; // зелена задача (зокрема пробна) закриває брейкер і скидає лічильники
  const failure = o.failure ?? 'unknown';
  const sameFails = failure === b.lastFailure ? b.sameFails + 1 : 1;
  const noProgress = b.noProgress + 1;
  const open = (trip: string, cooldownMin: number): Breaker => ({
    state: 'open', sameFails, noProgress, lastFailure: failure, openedAt: now.toISOString(), trip, cooldownMin, probeTaken: false,
  });
  // half-open: одна червона задача повертає open негайно, без накопичення, з довшим перепочинком
  if (b.state === 'half-open') {
    return open(`пробна задача провалилась (${failure})`, Math.min(b.cooldownMin * 2, RULES.maxCooldownMin));
  }
  if (RULES.openOnQuota && failure === 'quota') return open('відмова провайдера за квотою (429)', RULES.cooldownMin);
  if (sameFails >= RULES.sameFailures) return open(`${sameFails} однакові відмови підряд (${failure})`, RULES.cooldownMin);
  if (noProgress >= RULES.noProgress) return open(`${noProgress} задач підряд без прогресу`, RULES.cooldownMin);
  return { ...b, sameFails, noProgress, lastFailure: failure };
}

/** Обгортки з файлом — для черги й CI. */
export function mayRun(now = new Date(), file = BREAKER_FILE): Decision {
  const current = load(file);
  const { decision, next } = decide(current, now);
  if (next !== current) save(next, file);
  return decision;
}

export function record(o: Outcome, now = new Date(), file = BREAKER_FILE): Breaker {
  const next = apply(load(file), o, now);
  save(next, file);
  return next;
}
