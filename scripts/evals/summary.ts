/**
 * Зведення й порівняння прогонів evals (крок 04) — чисті функції, тому тестуються без агента.
 * pass@k — хоч одна успішна спроба з k; pass^k — усі k спроб успішні.
 */
export interface Line {
  readonly task_id: string;
  readonly bucket: string;
  readonly frozen_at: string;
  readonly attempt: number;
  readonly pass: boolean;
  readonly duration_s?: number;
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cost_usd_estimate?: number | null;
  readonly exit_status?: string;
}

export interface BucketRow {
  readonly bucket: string;
  readonly tasks: number;
  readonly pass_at_k: number;
  readonly pass_pow_k: number;
  readonly median_duration_s: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost_usd_estimate: number;
}

export interface TaskTally {
  readonly bucket: string;
  readonly frozen_at: string;
  readonly ok: number;
  readonly n: number;
}

export function tally(lines: readonly Line[]): Map<string, TaskTally> {
  const by = new Map<string, TaskTally>();
  for (const l of lines) {
    const c = by.get(l.task_id) ?? { bucket: l.bucket, frozen_at: l.frozen_at, ok: 0, n: 0 };
    by.set(l.task_id, { ...c, ok: c.ok + (l.pass ? 1 : 0), n: c.n + 1 });
  }
  return by;
}

const median = (xs: readonly number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/** Числа по кошиках. pass^k зараховує задачу, лише якщо зроблено рівно k спроб і всі успішні. */
export function summarize(lines: readonly Line[], k: number): BucketRow[] {
  const tasks = tally(lines);
  const buckets = [...new Set([...tasks.values()].map((t) => t.bucket))].sort();
  return buckets.map((bucket) => {
    const ts = [...tasks.values()].filter((t) => t.bucket === bucket);
    const ls = lines.filter((l) => l.bucket === bucket);
    const sum = (f: (l: Line) => number | null | undefined) => ls.reduce((n, l) => n + (f(l) ?? 0), 0);
    return {
      bucket,
      tasks: ts.length,
      pass_at_k: ts.filter((t) => t.ok >= 1).length / ts.length,
      pass_pow_k: ts.filter((t) => t.n === k && t.ok === k).length / ts.length,
      median_duration_s: median(ls.map((l) => l.duration_s ?? 0)),
      input_tokens: sum((l) => l.input_tokens),
      output_tokens: sum((l) => l.output_tokens),
      cost_usd_estimate: Math.round(sum((l) => l.cost_usd_estimate) * 10_000) / 10_000,
    };
  });
}

export type Baseline = Record<string, { readonly pow_k: number; readonly k: number; readonly bucket: string; readonly frozen_at: string }>;

export function toBaseline(lines: readonly Line[], k: number): Baseline {
  const out: Record<string, Baseline[string]> = {};
  for (const [id, t] of tally(lines)) out[id] = { pow_k: t.n === k && t.ok === k ? 1 : t.ok / k, k, bucket: t.bucket, frozen_at: t.frozen_at };
  return out;
}

/**
 * Брама: порівнюємо ЗАДАЧІ поіменно, а не середнє. Падає, якщо
 * — банк не заморожений (різні frozen_at у прогоні) або заморожений інакше, ніж базовий рівень;
 * — задача regression, що в базовому рівні мала pass^k = 1, зараз має менше або не прогонялась.
 * Кошики edge і new у брамі не беруть участі.
 */
export function compare(lines: readonly Line[], base: Baseline): { ok: boolean; problems: string[]; checked: number } {
  const now = tally(lines);
  const problems: string[] = [];
  const frozen = new Set([...now.values()].map((t) => t.frozen_at));
  const baseFrozen = new Set(Object.values(base).map((b) => b.frozen_at));
  if (frozen.size !== 1) problems.push(`банк не заморожений: frozen_at = ${[...frozen].join(', ') || 'немає'}`);
  else if (baseFrozen.size !== 1 || [...frozen][0] !== [...baseFrozen][0]) {
    problems.push(`прогін і базовий рівень з різних банків: ${[...frozen].join(', ')} проти ${[...baseFrozen].join(', ')}`);
  }
  let checked = 0;
  for (const [id, b] of Object.entries(base)) {
    if (b.bucket !== 'regression' || b.pow_k !== 1) continue;
    const t = now.get(id);
    if (t === undefined) {
      problems.push(`${id}: була pass^${b.k} = 1, а зараз не прогонялась`);
      continue;
    }
    checked += 1;
    if (t.ok !== t.n) problems.push(`${id}: було pass^${b.k} = 1, стало ${t.ok}/${t.n}`);
  }
  return { ok: problems.length === 0, problems, checked };
}
