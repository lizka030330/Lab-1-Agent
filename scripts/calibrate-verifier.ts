/**
 * Калібрування верифікатора (Лаб. 2, крок 03). ХОДИТЬ У МЕРЕЖУ — лише вручну:
 *
 *   npx tsx --env-file=.env.local scripts/calibrate-verifier.ts
 *
 * Читає docs/lab2/verify-calibration.jsonl: реальна зміна (коміт) × один критерій × МІЙ ручний вердикт.
 * Ручний вердикт ставиться ДО запуску; скрипт відмовляється працювати, якщо хоч один порожній.
 * Для кожного випадку — git diff коміту, той самий суддя й промпт, що в scripts/verify.ts.
 * Результат: docs/lab2/verify-calibration-run.json і таблиця для docs/lab2/verifier.md.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { chatCompletionsModel } from '../src/agent/adapters';
import { filterDiff, findSecret, judgeCriterion, parseCriteria } from '../src/verify/verify';

interface Case {
  readonly n: number;
  readonly commit: string;
  readonly criterion: string;
  readonly human: string;
  readonly what: string;
}

const cases = readFileSync('docs/lab2/verify-calibration.jsonl', 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Case);

const unlabeled = cases.filter((c) => !['pass', 'fail', 'unknown'].includes(c.human));
if (unlabeled.length > 0) {
  throw new Error(`спершу ручна розмітка: порожній або неправильний human у випадках ${unlabeled.map((c) => c.n).join(', ')}`);
}

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY порожній: заповніть .env.local');
const modelId = process.env.VERIFY_MODEL ?? 'gemini-3.5-flash-lite';
const model = chatCompletionsModel({
  url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  model: modelId,
  headers: { authorization: `Bearer ${key}` },
});
const criteria = parseCriteria(readFileSync('docs/lab2/spec.md', 'utf8'));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const rows: Array<Case & { readonly judge: string; readonly reason: string; readonly match: boolean }> = [];
for (const c of cases) {
  const criterion = criteria.find((x) => x.id === c.criterion);
  if (criterion === undefined) throw new Error(`критерію ${c.criterion} немає в spec.md`);
  const diff = filterDiff(execFileSync('git', ['diff', `${c.commit}^`, c.commit], { encoding: 'utf8', maxBuffer: 20_000_000 }));
  if (findSecret(diff)) throw new Error(`у diff ${c.commit} схоже на ключ — не відправляю`);
  await sleep(4000);
  const v = await judgeCriterion(model, criterion, diff);
  const row = { ...c, judge: v.verdict, reason: v.reason, match: v.verdict === c.human };
  rows.push(row);
  console.log(`${c.n}. ${c.commit} ${c.criterion}: я — ${c.human}, суддя — ${v.verdict} ${row.match ? '✓' : '✗'}  ${v.reason.slice(0, 100)}`);
}

const matched = rows.filter((r) => r.match).length;
const unknowns = rows.filter((r) => r.judge === 'unknown').length;
writeFileSync(
  'docs/lab2/verify-calibration-run.json',
  `${JSON.stringify({ date: new Date().toISOString(), model: modelId, matched, total: rows.length, rows }, null, 2)}\n`,
  'utf8',
);

console.log('\n| № | Зміна | Мій ручний вердикт | Вердикт верифікатора | Збіг | Коментар |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.n} | \`${r.commit}\` ${r.criterion}: ${r.what} | ${r.human} | ${r.judge} | ${r.match ? '✓' : '✗'} | ${r.reason.replace(/\|/g, '/').slice(0, 150)} |`);
}
console.log(`\nВипадків: ${rows.length}; збіг: ${matched} (${Math.round((matched / rows.length) * 100)}%); unknown у судді: ${unknowns}`);
