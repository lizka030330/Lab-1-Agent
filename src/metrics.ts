/**
 * МЕТРИКИ ПОШУКУ (крок 06). Мережі тут немає — лише арифметика над переліками id,
 * тому модуль покривається звичайними тестами в CI без ключів.
 * Визначення: Manning, Raghavan, Schütze, «Introduction to Information Retrieval», 2008;
 * MRR — TREC-8 QA Track (Voorhees, NIST, 2000).
 */

/** Один знайдений фрагмент. Порядок у масиві = порядок ранжування вашого пошуку. */
export interface Hit {
  readonly docId: string;
  readonly chunkId: string;
}

export type Verdict = 'correct' | 'partial' | 'wrong' | 'refused';

/** Документи за топ-k ФРАГМЕНТАМИ, у порядку першої появи, без повторів. */
export function docsAtK(hits: readonly Hit[], k: number): string[] {
  const out: string[] = [];
  for (const hit of hits.slice(0, k)) {
    if (!out.includes(hit.docId)) out.push(hit.docId);
  }
  return out;
}

/** recall@k: частка документів з must_cite, що дійшли до моделі. */
export function recallAtK(hits: readonly Hit[], mustCite: readonly string[], k: number): number {
  if (mustCite.length === 0) {
    throw new RangeError('recall@k не визначено для запиту з порожнім must_cite');
  }
  const found = docsAtK(hits, k).filter((id) => mustCite.includes(id)).length;
  return found / mustCite.length;
}

/** Обернений ранг першого влучання серед топ-k ФРАГМЕНТІВ. Немає влучань — 0. */
export function reciprocalRank(hits: readonly Hit[], mustCite: readonly string[], k: number): number {
  if (mustCite.length === 0) {
    throw new RangeError('MRR не визначено для запиту з порожнім must_cite');
  }
  const i = hits.slice(0, k).findIndex((hit) => mustCite.includes(hit.docId));
  return i === -1 ? 0 : 1 / (i + 1);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('середнє порожнього переліку не визначено — скільки запитів ви взяли?');
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * nDCG@k для НЕбінарної релевантності: `gains` — оцінка кожного документа (0, 1, 2…).
 * Беріть лише тоді, коли ці оцінки у вас справді розставлені рукою.
 */
export function ndcgAtK(hits: readonly Hit[], gains: Readonly<Record<string, number>>, k: number): number {
  const dcg = (gs: readonly number[]): number => gs.reduce((s, g, i) => s + g / Math.log2(i + 2), 0);
  const got = docsAtK(hits, k).map((id) => gains[id] ?? 0);
  const ideal = Object.values(gains)
    .sort((a, b) => b - a)
    .slice(0, k);
  const best = dcg(ideal);
  return best === 0 ? 0 : dcg(got) / best;
}

/**
 * 95% інтервал для частки — НОРМАЛЬНЕ НАБЛИЖЕННЯ, 1,96 · sqrt(p(1−p)/n).
 * При n близько двох десятків це груба оцінка: наближення тримається погано
 * на краях (p близько 0 або 1). Число, яке вона дає, у звіті підписуйте
 * «обчислено» — це ваш розрахунок, а не величина з джерела.
 */
export function proportionCI95(successes: number, n: number): { p: number; halfWidth: number; lo: number; hi: number } {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n має бути цілим числом, більшим за нуль');
  if (!Number.isInteger(successes) || successes < 0 || successes > n) {
    throw new RangeError('successes має бути цілим від 0 до n');
  }
  const p = successes / n;
  const halfWidth = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return { p, halfWidth, lo: Math.max(0, p - halfWidth), hi: Math.min(1, p + halfWidth) };
}

/** Переходи вердиктів на ТИХ САМИХ запитах: що саме змінив пошук. */
export function transitions(
  before: Readonly<Record<string, Verdict>>,
  after: Readonly<Record<string, Verdict>>,
): { from: Verdict; to: Verdict; ids: string[] }[] {
  const buckets = new Map<string, { from: Verdict; to: Verdict; ids: string[] }>();
  for (const id of Object.keys(before)) {
    const to = after[id];
    const from = before[id];
    if (from === undefined || to === undefined) continue;
    const key = `${from}→${to}`;
    const bucket = buckets.get(key) ?? { from, to, ids: [] };
    bucket.ids.push(id);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.ids.length - a.ids.length);
}
