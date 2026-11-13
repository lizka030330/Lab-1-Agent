// Свідок ланцюга брам (Лаб. 3, крок 01). Не брама: збирає вердикти чотирьох брам у gate-record.json
// і дописує поле gates у run.json прогонів харнеса, які додала ця гілка (docs/lab3/runs/<id>-<мітка>/run.json).
// Факт — needs.<job>.result (видно й на впалій брамі); outputs.verdict — підтвердження, що брама дійшла до кінця.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const GATES = ['types', 'lint', 'tests', 'build'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? '' : (process.argv[i + 1] ?? '');
}

/** result: success | failure | cancelled | skipped; out: «pass» або порожньо. */
export function verdictOf(result, out) {
  if (result === 'success') return out === 'pass' ? 'pass' : 'fail'; // зелена без підтвердження — не довіряємо
  if (result === 'failure') return 'fail';
  return 'skipped'; // skipped або cancelled: брама не виконувалась
}

function changedRunFiles() {
  try {
    const out = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD', '--', 'docs/lab3/runs'], { encoding: 'utf8' });
    return out.split('\n').filter((f) => f.endsWith('/run.json') && existsSync(f));
  } catch {
    return []; // напр. push у сам main: порівнювати нема з чим
  }
}

export function main() {
  const gates = Object.fromEntries(GATES.map((g) => [g, verdictOf(arg(g), arg(`${g}-out`))]));
  const raw = Object.fromEntries(GATES.map((g) => [g, { result: arg(g), verdict_output: arg(`${g}-out`) || null }]));

  const runs = [];
  for (const file of changedRunFiles()) {
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    const updated = { ...rec, gates };
    const out = join('gate-record', basename(dirname(file)), 'run.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    runs.push({ task_id: rec.task_id, run_json: file, updated_copy: out, acceptance_passed: rec.acceptance_passed });
  }

  const record = {
    run_url: arg('run-url') || null,
    sha: process.env.GITHUB_SHA ?? null,
    ref: process.env.GITHUB_REF ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null,
    recorded_at: new Date().toISOString(),
    gates,
    raw,
    all_pass: GATES.every((g) => gates[g] === 'pass'),
    harness_runs: runs,
  };
  writeFileSync('gate-record.json', `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ gates, all_pass: record.all_pass, harness_runs: runs.map((r) => r.task_id) }));
}

// Імпорт у тесті не повинен нічого писати.
if (process.argv[1]?.endsWith('record-gates.mjs')) main();
