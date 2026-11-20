/**
 * Регресійна брама evals (Лаб. 3, крок 04). Ненульовий код виходу — єдиний спосіб,
 * яким GitHub Actions дізнається, що щось зламалося.
 *
 *   npx tsx scripts/evals/gate.ts                    порівняти docs/lab3/evals.jsonl з базовим рівнем
 *   npx tsx scripts/evals/gate.ts --write-baseline   записати базовий рівень — РІВНО раз, окремим комітом
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { compare, toBaseline, type Baseline, type Line } from './summary';

const K = Number(process.env.EVAL_K ?? 3);
const LOG = process.env.EVAL_LOG ?? 'docs/lab3/evals.jsonl';
const BASE = 'docs/lab3/evals-baseline.json';

const lines: Line[] = readFileSync(LOG, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Line);
if (lines.length === 0) {
  console.error(`${LOG} порожній — прогону не було, брамі нема з чим порівнювати`);
  process.exit(1);
}

if (process.argv.includes('--write-baseline')) {
  const base = toBaseline(lines, K);
  writeFileSync(BASE, `${JSON.stringify(base, null, 2)}\n`);
  console.log(`базовий рівень записано на ${Object.keys(base).length} задач (k = ${K}) — закомітьте його НАВМИСНО окремим комітом`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASE, 'utf8')) as Baseline;
const r = compare(lines, base);
if (!r.ok) {
  console.error(`БРАМА EVALS: ${r.problems.length} проблем(и):\n${r.problems.join('\n')}`);
  process.exit(1);
}
console.log(`регресії немає: перевірено ${r.checked} задач regression з pass^k = 1 у базовому рівні`);
