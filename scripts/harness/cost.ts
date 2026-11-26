/**
 * Облік вартості прогону харнеса (Лаб. 4, крок 07).
 *
 * Агент харнеса — OpenCode, а не AI SDK напряму, тож «totalUsage» прогону тут — це СУМА подій `step_finish`
 * однієї сесії OpenCode: кожна подія несе `part.tokens = { input, output, reasoning, cache: { read, write } }`
 * і `part.cost` (за прайсом models.dev, який знає OpenCode). Назви полів зчитано з output.txt прогонів Лаб. 3.
 *
 * Правило звіту: не повідомлене — null, а не 0. `?? 0` дозволений лише в сумі зведення,
 * і поруч завжди «повідомлено N/M».
 */

/** Шість кошиків одного прогону (одна спроба однієї моделі). null = агент це поле не повідомив. */
export interface Usage {
  readonly input: number | null;
  readonly cache_read: number | null;
  readonly cache_write: number | null;
  readonly output: number | null;
  readonly reasoning: number | null;
  readonly cost_usd: number | null;
}

export const EMPTY: Usage = { input: null, cache_read: null, cache_write: null, output: null, reasoning: null, cost_usd: null };

/** null лишається null, поки ЖОДНЕ джерело цього поля не повідомило. */
export function add(a: number | null, v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? (a ?? 0) + v : a;
}

export interface Attempt {
  readonly model: string;
  readonly usage: Usage;
  /** подій step_finish = кроків моделі */
  readonly steps: number;
  /** подій tool_use = викликів інструментів */
  readonly tool_calls: number;
  /** рядків `stream error` агента harness у журналі OpenCode — невдалих викликів моделі, які він повторював */
  readonly retries: number;
  /** викликів службової моделі заголовка (`agent=title`) — їхніх токенів у подіях кроків НЕМАЄ */
  readonly title_calls: number;
  readonly duration_s: number;
  readonly passed: boolean;
  readonly exit_status: string;
  readonly artifact: string;
}

function events(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const o = JSON.parse(s) as unknown;
      if (o !== null && typeof o === 'object') out.push(o as Record<string, unknown>);
    } catch {
      /* не JSON */
    }
  }
  return out;
}

/** Сума всіх step_finish прогону — аналог totalUsage. */
export function readUsage(stdout: string): { usage: Usage; steps: number; tool_calls: number } {
  let u: Usage = EMPTY;
  let steps = 0;
  let tool_calls = 0;
  for (const ev of events(stdout)) {
    if (ev.type === 'tool_use') tool_calls += 1;
    if (ev.type !== 'step_finish') continue;
    steps += 1;
    const part = (ev.part ?? {}) as { tokens?: Record<string, unknown>; cost?: unknown };
    const t = part.tokens ?? {};
    const cache = (t.cache ?? {}) as Record<string, unknown>;
    u = {
      input: add(u.input, t.input),
      cache_read: add(u.cache_read, cache.read),
      cache_write: add(u.cache_write, cache.write),
      output: add(u.output, t.output),
      reasoning: add(u.reasoning, t.reasoning),
      cost_usd: add(u.cost_usd, part.cost),
    };
  }
  return { usage: u, steps, tool_calls };
}

/**
 * Лічильник повторів і службових викликів — з журналу OpenCode (--print-logs), бо в подіях і трасі повторів не видно.
 * Формат рядків зчитано з agent.log прогонів Лаб. 3 (`input` у step_finish — НЕКЕШОВАНИЙ вхід: кеш-читання окремо;
 * перевірено арифметикою — сума за прайсом збігається з `cost`, який повідомив OpenCode, див. cost.md):
 *   `message=stream … agent=harness`        — виклик моделі агента;
 *   `message="stream error" … agent=harness` — невдалий виклик (OpenCode повторює; `AI_RetryError: Failed after 3 attempts`);
 *   `message=stream … small=true agent=title` — службова модель заголовка сесії: її токенів у step_finish НЕМАЄ.
 */
const STEP_LIMIT = /Requests ending with a model turn are not supported/i;

export function readLog(stderr: string): { model_calls: number; retries: number; title_calls: number } {
  let model_calls = 0;
  let retries = 0;
  let title_calls = 0;
  for (const line of stderr.split(/\r?\n/)) {
    const isStream = /\bmessage=stream\b/.test(line);
    // «Requests ending with a model turn» — це сигнал межі кроків (Лаб. 3, крок 06), а не повтор
    if (/message="stream error"/.test(line) && /\bagent=harness\b/.test(line) && !STEP_LIMIT.test(line)) retries += 1;
    if (isStream && /\bagent=harness\b/.test(line)) model_calls += 1;
    if (isStream && /\bagent=title\b/.test(line)) title_calls += 1;
  }
  return { model_calls, retries, title_calls };
}

export interface TaskCost {
  readonly task_id: string;
  readonly config: string;
  /** модель(і) спроб, дослівно, у порядку */
  readonly models: string[];
  readonly escalated: boolean;
  readonly trace_id: string | null;
  readonly steps: number;
  readonly tool_calls: number;
  readonly retries: number;
  readonly title_calls: number;
  readonly input_tokens: number | null;
  readonly cache_read: number | null;
  readonly cache_write: number | null;
  readonly output_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly cost_usd_reported: number | null;
  readonly duration_s: number;
  readonly passed: boolean;
  readonly attempts: { model: string; passed: boolean; exit_status: string; artifact: string }[];
}

/**
 * Одна спроба на звичайну задачу і ДВІ на задачу з підняттям моделі:
 * вартість підняття = токени обох спроб, інакше звіт бреше на користь дешевої моделі.
 * passed — результат ОСТАННЬОЇ спроби.
 */
export function toTaskCost(base: { task_id: string; config: string; trace_id: string | null }, attempts: readonly Attempt[]): TaskCost {
  if (attempts.length === 0) throw new Error(`${base.task_id}: немає жодної спроби`);
  const last = attempts[attempts.length - 1]!;
  let u: Usage = EMPTY;
  for (const a of attempts) {
    u = {
      input: add(u.input, a.usage.input),
      cache_read: add(u.cache_read, a.usage.cache_read),
      cache_write: add(u.cache_write, a.usage.cache_write),
      output: add(u.output, a.usage.output),
      reasoning: add(u.reasoning, a.usage.reasoning),
      cost_usd: add(u.cost_usd, a.usage.cost_usd),
    };
  }
  const sum = (f: (a: Attempt) => number) => attempts.reduce((s, a) => s + f(a), 0);
  return {
    ...base,
    models: attempts.map((a) => a.model),
    escalated: attempts.length > 1,
    steps: sum((a) => a.steps),
    tool_calls: sum((a) => a.tool_calls),
    retries: sum((a) => a.retries),
    title_calls: sum((a) => a.title_calls),
    input_tokens: u.input,
    cache_read: u.cache_read,
    cache_write: u.cache_write,
    output_tokens: u.output,
    reasoning_tokens: u.reasoning,
    cost_usd_reported: u.cost_usd,
    duration_s: Math.round(sum((a) => a.duration_s) * 10) / 10,
    passed: last.passed,
    attempts: attempts.map((a) => ({ model: a.model, passed: a.passed, exit_status: a.exit_status, artifact: a.artifact })),
  };
}

/** Зведення: сума окремо і ОКРЕМО — скількома задачами поле взагалі повідомлене. */
export function summarise(rows: readonly TaskCost[]) {
  const sum = (f: (r: TaskCost) => number | null) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
  const reported = (f: (r: TaskCost) => number | null) => `${rows.filter((r) => f(r) !== null).length}/${rows.length}`;
  const passed = rows.filter((r) => r.passed).length;
  const inputs = sum((r) => r.input_tokens);
  const outputs = sum((r) => r.output_tokens);
  const reasoning = sum((r) => r.reasoning_tokens);
  const cacheRead = sum((r) => r.cache_read);
  const cacheWrite = sum((r) => r.cache_write);
  return {
    tasks: rows.length,
    passed,
    pass_share: rows.length === 0 ? 0 : passed / rows.length,
    escalations: rows.filter((r) => r.escalated).length,
    input_tokens: inputs,
    input_reported: reported((r) => r.input_tokens),
    cache_read: cacheRead,
    cache_read_reported: reported((r) => r.cache_read),
    cache_write: cacheWrite,
    cache_write_reported: reported((r) => r.cache_write),
    output_tokens: outputs,
    output_reported: reported((r) => r.output_tokens),
    reasoning_tokens: reasoning,
    reasoning_reported: reported((r) => r.reasoning_tokens),
    cost_usd: Math.round(sum((r) => r.cost_usd_reported) * 1e4) / 1e4,
    cost_reported: reported((r) => r.cost_usd_reported),
    steps: rows.reduce((a, r) => a + r.steps, 0),
    tool_calls: rows.reduce((a, r) => a + r.tool_calls, 0),
    retries: rows.reduce((a, r) => a + r.retries, 0),
    duration_s: Math.round(rows.reduce((a, r) => a + r.duration_s, 0)),
    // У OpenCode `input` — лише НЕКЕШОВАНИЙ вхід; кеш-читання — окремий кошик і найбільший за обсягом.
    // Тому «усього токенів» = некешований вхід + кеш-читання + кеш-запис + вихід + reasoning.
    all_tokens: inputs + cacheRead + cacheWrite + outputs + reasoning,
    // головне число порівняння: ціна ОДНІЄЇ пройденої задачі — усі кошики
    tokens_per_passed: passed === 0 ? null : Math.round((inputs + cacheRead + cacheWrite + outputs + reasoning) / passed),
    usd_per_passed: passed === 0 ? null : Math.round((sum((r) => r.cost_usd_reported) / passed) * 1e4) / 1e4,
  };
}

const cell = (v: number | null) => (v === null ? 'не повідомлено' : String(v));

export const TASK_TABLE_HEADER = [
  '| task_id | модель(і) | кроків | викликів інстр. | повторів | вхід | кеш-читання | кеш-запис | вихід | reasoning | $ (OpenCode) | час, с | пройдено |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
].join('\n');

export function taskRow(r: TaskCost): string {
  const models = r.attempts.map((a) => `${a.model.replace(/^google\//, '')}${a.passed ? ' ✓' : ' ✗'}`).join(' → ');
  return `| ${r.task_id} | ${models} | ${r.steps} | ${r.tool_calls} | ${r.retries} | ${cell(r.input_tokens)} | ${cell(r.cache_read)} | ${cell(r.cache_write)} | ${cell(r.output_tokens)} | ${cell(r.reasoning_tokens)} | ${r.cost_usd_reported === null ? 'не повідомлено' : r.cost_usd_reported.toFixed(4)} | ${r.duration_s} | ${r.passed ? 'так' : 'ні'} |`;
}
