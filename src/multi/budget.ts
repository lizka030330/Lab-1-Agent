/**
 * БЮДЖЕТ мультиагентного питання (Лаб. 4, крок 03): гілки, ходи, кроки, токени, час.
 * Мій шлях платний (Gemini API, Tier 1), тому окремо рахується й сума в доларах — за src/cost.ts,
 * але межею в коді вона не є: межі тримають ходи й токени, гроші з них лише виводяться.
 *
 * Визначення (docs/lab4/multiagent.md):
 *   крок (step) — один оберт циклу «запит до моделі → виклики інструментів» усередині ОДНОГО generateText;
 *                 його рахує isStepCount(N). Кожен крок — окремий HTTP-запит до провайдера.
 *   хід (turn)  — один виклик моделі з боку оркестратора: одна гілка, один звід або один запит верифікатора.
 */

export type Budget = {
  /** Скільки гілок ЧИТАННЯ дозволено в одному раунді. */
  maxBranches: number;
  /** ХОДИ: скільки викликів моделі дозволено на все питання (гілки + звід + верифікатор). */
  maxTurns: number;
  /** КРОКИ: isStepCount(N) у stopWhen кожної гілки. */
  stepsPerBranch: number;
  /** ТОКЕНИ: стеля на все питання — входи + виходи всіх гілок і зводу. */
  tokenCeiling: number;
  /** ЧАС: стеля на все питання, мілісекунди. */
  wallClockMs: number;
};

/** Значення за промовчанням; обґрунтування кожного числа — docs/lab4/multiagent.md, розділ «Бюджет». */
export const DEFAULT_BUDGET: Budget = {
  maxBranches: 4,
  maxTurns: 12,
  stepsPerBranch: 6,
  tokenCeiling: 400_000,
  wallClockMs: 180_000,
};

/**
 * Структурний тип: лише ті поля, які читаємо. У AI SDK 7 вони number | undefined —
 * провайдер може не повідомити жодного; непідраховане НЕ пишеться як нуль.
 */
export type Usage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined; noCacheTokens?: number | undefined };
};

export type Spent = {
  /** ХОДИ: скільки викликів моделі зроблено (разом з упалими й скасованими). */
  calls: number;
  /** КРОКИ: скільки HTTP-запитів до провайдера пішло всередині цих ходів (там, де відомо). */
  steps: number;
  input: number;
  output: number;
  /** Кешовані вхідні токени — лише там, де провайдер їх повідомив. */
  cacheRead: number;
  /** Скільком ходам провайдер токенів НЕ повідомив. У звіт — як «не повідомлено». */
  unreported: number;
  /** СУМА часу по ходах — час обчислення, а НЕ час до відповіді (той міряється окремо, wallMs). */
  ms: number;
};

export const empty = (): Spent => ({ calls: 0, steps: 0, input: 0, output: 0, cacheRead: 0, unreported: 0, ms: 0 });

export function add(s: Spent, u: Usage, ms: number, steps = 1): Spent {
  const known = u.inputTokens !== undefined || u.outputTokens !== undefined;
  return {
    calls: s.calls + 1,
    steps: s.steps + steps,
    input: s.input + (u.inputTokens ?? 0),
    output: s.output + (u.outputTokens ?? 0),
    cacheRead: s.cacheRead + (u.inputTokenDetails?.cacheReadTokens ?? 0),
    unreported: s.unreported + (known ? 0 : 1),
    ms: s.ms + ms,
  };
}

/** Гілка, що впала або була скасована, хід уже списала — просто не звітує. Ховати її не можна. */
export function addLost(s: Spent, ms: number): Spent {
  return { ...s, calls: s.calls + 1, unreported: s.unreported + 1, ms: s.ms + ms };
}

export const tokensUsed = (s: Spent) => s.input + s.output;

export function merge(a: Spent, b: Spent): Spent {
  return {
    calls: a.calls + b.calls,
    steps: a.steps + b.steps,
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    unreported: a.unreported + b.unreported,
    ms: a.ms + b.ms,
  };
}

export type Stop = 'none' | 'token-ceiling' | 'turn-budget' | 'wall-clock';

/**
 * Перевірка меж: next — скільки ходів збираємося витратити. Викликається ПЕРЕД раундом (next = гілок)
 * і ПІСЛЯ нього, на fan-in (next = 0), — інакше при одному раунді стеля токенів не спрацює ніколи.
 */
export function overBudget(b: Budget, s: Spent, next: number, aborted: boolean): Stop {
  if (s.calls + next > b.maxTurns) return 'turn-budget';
  if (tokensUsed(s) >= b.tokenCeiling) return 'token-ceiling';
  if (aborted) return 'wall-clock';
  return 'none';
}
