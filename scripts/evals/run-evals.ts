/**
 * Прогін банку задач (Лаб. 3, крок 04): k спроб на задачу, КОЖНА — у новому git worktree від HEAD.
 * Пише docs/lab3/evals.jsonl (одна спроба = один рядок) і друкує зведення pass@k / pass^k.
 *
 *   EVAL_K=3 npx tsx scripts/evals/run-evals.ts docs/lab3/tasks.jsonl
 *   EVAL_BUCKET=regression EVAL_K=1 …   — лише один кошик (так у CI)
 *   EVAL_IDS=t-14,t-15 …                — лише ці задачі (розвідувальний прогін нових задач)
 *   EVAL_RESUME=1 …                     — дописати той самий прогін після добової квоти: журнал не стирається,
 *                                         уже зроблені (валідні) спроби не повторюються
 *
 * Агент — той самий, що у фабриці: OpenCode, агент `harness`, модель HARNESS_MODEL.
 * Квоти безкоштовного Gemini — дві різні (19.11.2026, agent.log t-18-1795086963468):
 *   «input tokens per minute … limit: 250000» — хвилинна: чекаємо й повторюємо ту саму спробу (до 3 разів);
 *   добова — зупиняє ВЕСЬ прогін з кодом 2: неповний прогін брамі віддавати не можна.
 * Спроба, обірвана квотою, — не вердикт агента: пишемо її з invalid і в числа не рахуємо.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { opencodeRunner, OPENCODE_MODEL, runTask, type Task } from '../harness/run-task';
import { grade, unknownLabels } from './graders';
import { summarize, type Line } from './summary';

const K = Number(process.env.EVAL_K ?? 3);
const ONLY = process.env.EVAL_BUCKET ?? '';
const IDS = new Set((process.env.EVAL_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
// між спробами: одна спроба — до ~60 тис. вхідних токенів, а хвилинна межа — 250 тис.
const PAUSE_S = Number(process.env.EVAL_PAUSE_S ?? 30);
const PER_MINUTE = /per minute/i;
const BANK = process.argv[2] ?? 'docs/lab3/tasks.jsonl';
const LOG = process.env.EVAL_LOG ?? 'docs/lab3/evals.jsonl';
const ROOT = resolve('.');
const git = (args: string[], cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const SHA = git(['rev-parse', '--short', 'HEAD']).trim();
const read = (dir: string, name: string) => {
  try {
    return readFileSync(join(dir, name), 'utf8');
  } catch {
    return '';
  }
};

const tasks: Task[] = readFileSync(BANK, 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Task)
  .filter((t) => t.label !== undefined) // у банку лише задачі з міткою
  .filter((t) => ONLY === '' || t.bucket === ONLY)
  .filter((t) => IDS.size === 0 || IDS.has(t.id));

if (tasks.length === 0) throw new Error('немає задач для прогону (перевірте EVAL_BUCKET / EVAL_IDS і поле label)');
for (const t of tasks) {
  const bad = unknownLabels(t);
  if (bad.length > 0) throw new Error(`${t.id}: невідомі оцінювачі в label: ${bad.join(', ')}`);
}

const RESUME = process.env.EVAL_RESUME === '1';
// журнал ОСТАННЬОГО прогону: старі рядки не змішуємо з новими — крім продовження того самого прогону
const previous: Line[] = RESUME && existsSync(LOG)
  ? readFileSync(LOG, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Line)
  : [];
if (!RESUME) writeFileSync(LOG, '');
const lines: Line[] = previous.filter((l) => l.invalid === undefined);
const done = (id: string) => lines.filter((l) => l.task_id === id).length;
if (RESUME) console.log(`продовження: у журналі вже ${lines.length} валідних спроб`);
let aborted = false;

outer: for (const task of tasks) {
  let retries = 0;
  for (let attempt = done(task.id) + 1; attempt <= K; attempt += 1) {
    // ЧИСТЕ середовище на КОЖНУ спробу, а не на задачу: інакше друга спроба бачить файли першої.
    const stamp = Date.now();
    const branch = `eval/${task.id}-${attempt}-${stamp}`;
    const tree = resolve(ROOT, '..', 'eval-runs', `${task.id}-${attempt}-${stamp}`);
    git(['worktree', 'add', '-b', branch, tree, 'HEAD']);
    try {
      if (!existsSync(join(tree, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'));
      const rec = await runTask(task, { runner: opencodeRunner, agentPath: `opencode+${OPENCODE_MODEL}`, worktree: tree, outDir: join(ROOT, 'runs') });
      const results = grade({ task, patch: read(rec.artifact_dir, 'patch.diff'), output: read(rec.artifact_dir, 'output.txt'), acceptance: rec.acceptance });
      const quota = rec.exit_status === 'quota';
      const perMinute = quota && PER_MINUTE.test(read(rec.artifact_dir, 'agent.log') + read(rec.artifact_dir, 'output.txt'));
      const line = {
        task_id: task.id,
        bucket: task.bucket ?? 'new',
        frozen_at: task.frozen_at ?? '',
        attempt,
        sha: SHA,
        model: OPENCODE_MODEL,
        // спроба успішна, лише якщо ВСІ оцінювачі з мітки збіглися з міткою
        pass: !quota && results.length > 0 && results.every((r) => r.pass),
        ...(quota ? { invalid: perMinute ? 'quota_per_minute' : 'quota' } : {}),
        graders: results,
        duration_s: rec.duration_s,
        input_tokens: rec.input_tokens,
        output_tokens: rec.output_tokens,
        cost_usd_estimate: rec.cost_usd_estimate, // клієнтська ОЦІНКА за прайсом, не рахунок
        exit_status: rec.exit_status,
        artifact: rec.artifact_dir.replace(`${ROOT}/`, ''),
        trace_id: rec.trace_id, // крок 06 заповнює це поле
        at: new Date().toISOString(),
      };
      appendFileSync(LOG, `${JSON.stringify(line)}\n`);
      // EVAL_KEEP=1 — розвідувальний прогін: артефакт стає джерелом (source) нової задачі в банку
      if (process.env.EVAL_KEEP === '1' && !quota) cpSync(rec.artifact_dir, join(ROOT, 'docs', 'lab3', 'runs', rec.artifact_dir.split('/').pop() ?? task.id), { recursive: true });
      if (!quota) lines.push(line);
      console.log(`${task.id} #${attempt}: ${line.pass ? 'pass' : 'FAIL'} (${rec.exit_status}, ${rec.duration_s} с) ${results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.detail}`).join('; ')}`);
      if (perMinute && retries < 3) {
        retries += 1;
        console.error(`ХВИЛИННА КВОТА: чекаю 65 с і повторюю ${task.id} #${attempt} (повтор ${retries}/3)`);
        attempt -= 1; // та сама спроба ще раз — у новому дереві
        await new Promise((r) => setTimeout(r, 65_000));
        continue;
      }
      if (quota) {
        console.error(`КВОТА: ${OPENCODE_MODEL} відмовив за квотою (${perMinute ? 'хвилинна, 3 повтори не допомогли' : 'добова'}) — прогін зупинено, брамі він не годиться.`);
        aborted = true;
        break outer;
      }
      retries = 0;
    } finally {
      git(['worktree', 'remove', tree, '--force']);
      git(['branch', '-D', branch]);
    }
    await new Promise((r) => setTimeout(r, PAUSE_S * 1000));
  }
}

console.log(`\nk = ${K}, банк ${BANK}, коміт ${SHA}, модель ${OPENCODE_MODEL}`);
console.table(summarize(lines, K));
process.exit(aborted ? 2 : 0);
