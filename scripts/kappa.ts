/**
 * Згода верифікатора з моєю ручною розміткою (Лаб. 3, крок 02): сира згода і каппа Коена — окремо.
 *   npx tsx scripts/kappa.ts      читає docs/lab3/verify-calibration.jsonl і docs/lab3/verdicts/calibration/*.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Label = 'pass' | 'fail' | 'unknown';
export const LABELS: Label[] = ['pass', 'fail', 'unknown'];

/** mine[i] — мій ручний вердикт, judge[i] — вердикт верифікатора. */
export function agreement(mine: readonly Label[], judge: readonly Label[]) {
  const n = mine.length;
  if (n === 0 || n !== judge.length) throw new Error('різна довжина розмітки');
  const po = mine.filter((m, i) => m === judge[i]).length / n; // сира згода
  const pe = LABELS.reduce((acc, l) => {
    const pm = mine.filter((x) => x === l).length / n;
    const pj = judge.filter((x) => x === l).length / n;
    return acc + pm * pj;
  }, 0); // очікувана випадкова згода
  const kappa = pe === 1 ? NaN : (po - pe) / (1 - pe);
  return { n, raw: po, expected: pe, kappa };
}

/** Матриця невідповідностей: рядки — мій вердикт, стовпці — суддя. */
export function confusion(mine: readonly Label[], judge: readonly Label[]): Record<Label, Record<Label, number>> {
  const m = Object.fromEntries(LABELS.map((a) => [a, Object.fromEntries(LABELS.map((b) => [b, 0]))])) as Record<Label, Record<Label, number>>;
  mine.forEach((a, i) => { m[a][judge[i]!] += 1; });
  return m;
}

function main(): void {
  const rows = readFileSync('docs/lab3/verify-calibration.jsonl', 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { case: number; run: string; criterion: string; mine: Label });
  const mine: Label[] = [];
  const judge: Label[] = [];
  console.log('| № | Прогін | Критерій | Мій вердикт | Вердикт судді | Збіг |\n|---|---|---|---|---|---|');
  for (const r of rows) {
    const f = join('docs/lab3/verdicts/calibration', `${r.run}.json`);
    if (!existsSync(f)) throw new Error(`немає вердиктів судді для ${r.run}`);
    const j = (JSON.parse(readFileSync(f, 'utf8')) as { results: { id: string; verdict: Label }[] }).results.find((x) => x.id === r.criterion);
    if (!j) throw new Error(`суддя не оцінив ${r.run}/${r.criterion}`);
    mine.push(r.mine);
    judge.push(j.verdict);
    console.log(`| ${r.case} | ${r.run} | ${r.criterion} | ${r.mine} | ${j.verdict} | ${r.mine === j.verdict ? '✓' : '✗'} |`);
  }
  const a = agreement(mine, judge);
  console.log(`\nВипадків: ${a.n}\nСира згода: ${a.raw.toFixed(3)}\nОчікувана випадкова згода: ${a.expected.toFixed(3)}\nКаппа Коена: ${Number.isNaN(a.kappa) ? 'не визначена (усі мітки однакові)' : a.kappa.toFixed(3)}`);
  const m = confusion(mine, judge);
  console.log('\nМатриця (рядки — мій вердикт, стовпці — суддя):\n| мій \\ суддя | pass | fail | unknown |\n|---|---|---|---|');
  for (const l of LABELS) console.log(`| ${l} | ${m[l].pass} | ${m[l].fail} | ${m[l].unknown} |`);
}

if (process.argv[1]?.endsWith('kappa.ts')) main();
