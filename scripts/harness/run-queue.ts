/**
 * Черга фабрики (Лаб. 3, крок 00): одна задача (--id) або всі. Готує git worktree і прибирає після себе.
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-01 [--no-push]
 * Дерево — від поточного коміту (HEAD), на окремій гілці harness/<id>-<мітка>: так повторний прогін
 * тієї самої задачі не конфліктує з попередньою гілкою.
 * Крок 03: перед кожною задачею питаємо circuit breaker (src/harness/breaker.ts), після — повідомляємо результат;
 * брейкер відкрився — черга стоп. Кожне зупинення — рядок у docs/lab3/stop-log.jsonl. Ctrl+C прибирає worktree.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { mayRun, record } from '../../src/harness/breaker';
import { logStop } from '../../src/harness/stop';
import { runCostQueue } from './cost-queue';
import { opencodeRunner, OPENCODE_MODEL, runTask, type Task } from './run-task';
import { trace } from '@opentelemetry/api';
import './otel';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.jsonl')) ?? 'docs/lab3/tasks.jsonl';
const onlyId = args.includes('--id') ? (args[args.indexOf('--id') + 1] ?? null) : null;
const push = !args.includes('--no-push');
// Лаб. 4, крок 07: аудит вартості — конфігурація моделей і (необовʼязково) підмножина банку
const config = args.includes('--config') ? (args[args.indexOf('--config') + 1] ?? null) : null;
const ids = args.includes('--ids') ? new Set((args[args.indexOf('--ids') + 1] ?? '').split(',').filter(Boolean)) : null;

const tasks: Task[] = readFileSync(file, 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Task)
  .filter((t) => onlyId === null || t.id === onlyId)
  .filter((t) => ids === null || ids.has(t.id));

if (tasks.length === 0) throw new Error(`у ${file} немає задач${onlyId ? ` з id ${onlyId}` : ''}`);

const ROOT = resolve('.');
const git = (a: string[], cwd = ROOT) => execFileSync('git', a, { cwd, encoding: 'utf8' });
// Нові теки docs/lab3/runs/, стан брейкера й журнал зупинень пише сама черга — вони не заважають:
// дерево береться від HEAD, а вони в нього не потрапляють.
const OWN = ['docs/lab3/runs/', '.harness/', 'docs/lab3/stop-log.jsonl', 'docs/lab4/traces/cost-'];
const dirtyOf = () => git(['status', '--porcelain']).split('\n').filter((l) => l.trim() !== '' && !OWN.some((o) => l.includes(o)));
const dirtyBefore = dirtyOf();
if (dirtyBefore.length > 0) {
  throw new Error(`основний checkout не чистий: закомітьте зміни, інакше дерево прогону не побачить їх\n${dirtyBefore.join('\n')}`);
}

if (config !== null) {
  // окремий режим: інша модель на спробу, без брейкера, без комітів — див. cost-queue.ts
  await runCostQueue(tasks, config, ROOT);
  const after = dirtyOf();
  console.log(after.length === 0 ? 'основний checkout: чистий (крім docs/lab4/traces/cost-*)' : `УВАГА, основний checkout змінено:\n${after.join('\n')}`);
  process.exit(0);
}

// Ctrl+C посеред прогону: прибираємо дерево, а не лишаємо його руками (13.11 лишився worktree t-02)
let currentTree: string | null = null;
process.once('SIGINT', () => {
  if (currentTree !== null) {
    try {
      git(['worktree', 'remove', currentTree, '--force']);
      console.error(`\nCtrl+C: дерево ${currentTree} прибрано`);
    } catch (e) {
      console.error(`\nCtrl+C: не вдалося прибрати ${currentTree}: ${String(e)}`);
    }
  }
  process.exit(130);
});

for (const task of tasks) {
  // шар харнеса: брейкер вирішує, чи брати задачу взагалі
  const gate = mayRun();
  if (!gate.allow) {
    logStop({ taskId: task.id, layer: 'харнес', limit: 'circuit breaker', value: gate.why, next: 'задачу не запущено, черга зупинена' });
    console.log(`${task.id}: БРЕЙКЕР — ${gate.why}. Черга зупинена.`);
    break;
  }
  if (gate.probe) console.log(`${task.id}: ${gate.why}`);
  const stamp = Date.now();
  const branch = `harness/${task.id}-${stamp}`;
  const tree = resolve(ROOT, '..', 'harness-runs', `${task.id}-${stamp}`);
  git(['worktree', 'add', '-b', branch, tree, 'HEAD']);
  currentTree = tree;
  let opened = false;
  try {
    // залежності — посиланням на основне дерево (у .gitignore як «node_modules»)
    if (!existsSync(join(tree, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'));
    const tracer = trace.getTracer('harness');
    const rec = await tracer.startActiveSpan(`task ${task.id}`, async (span) => {
      try {
        const ctx = span.spanContext();
        // без запущеного SDK ідентифікатор нульовий — тоді пишемо null, а не фальшиве значення
        const traceId = /[^0]/.test(ctx.traceId) ? ctx.traceId : null;
        return await runTask(task, { runner: opencodeRunner, agentPath: `opencode+${OPENCODE_MODEL}`, worktree: tree, outDir: join(ROOT, 'runs'), traceId });
      } finally {
        span.end();
      }
    });
    // відібраний артефакт — у репозиторій; сира runs/ лишається в .gitignore
    const keep = join(ROOT, 'docs', 'lab3', 'runs', `${task.id}-${new Date(rec.started_at).getTime()}`);
    mkdirSync(keep, { recursive: true });
    cpSync(rec.artifact_dir, keep, { recursive: true });
    // зміни агента — комітом на гілці прогону (runTask уже зробив git add -A)
    const staged = git(['diff', '--cached', '--name-only'], tree).trim();
    // журнал прогону — у ту саму гілку: брами CI (крок 01) знаходять його і дописують поле gates
    if (staged !== '') {
      const inTree = join(tree, 'docs', 'lab3', 'runs', `${task.id}-${new Date(rec.started_at).getTime()}`);
      mkdirSync(inTree, { recursive: true });
      cpSync(rec.artifact_dir, inTree, { recursive: true });
      git(['add', '--', inTree], tree);
    }
    if (staged !== '') {
      git(['commit', '-m', `harness: ${task.id} (${rec.exit_status}, acceptance ${rec.acceptance_passed ? 'pass' : 'fail'})`], tree);
      if (push) git(['push', '-u', 'origin', branch], tree);
    }
    console.log(`${task.id}: ${rec.exit_status}, ${rec.duration_s} с, acceptance ${rec.acceptance_passed ? 'pass' : 'fail'}, змінено файлів: ${staged === '' ? 0 : staged.split('\n').length} → ${keep}`);

    // шар задачі: таймаут чи квота — рядок у журнал зупинень
    const run = `docs/lab3/runs/${task.id}-${new Date(rec.started_at).getTime()}`;
    if (rec.exit_status === 'timeout') {
      logStop({ taskId: task.id, layer: 'задача', limit: 'timeout_s (годинник стіни)', value: Math.min(task.budget.timeout_s, Number(process.env.HARNESS_MAX_TIMEOUT_S) || Infinity), duration_s: rec.duration_s, run, next: 'агента вбито (SIGKILL), артефакт записано, результат — брейкеру' });
    }
    if (rec.exit_status === 'quota') {
      logStop({ taskId: task.id, layer: 'задача', limit: 'квота провайдера (429)', value: OPENCODE_MODEL, duration_s: rec.duration_s, run, next: 'агента вбито на першій відмові, результат — брейкеру' });
    }
    // шар харнеса: результат — брейкеру
    const failure = rec.exit_status === 'ok' ? 'acceptance_fail' : rec.exit_status;
    const b = record({ ok: rec.acceptance_passed, failure });
    if (b.state === 'open') {
      opened = true;
      logStop({ taskId: task.id, layer: 'харнес', limit: 'circuit breaker', value: b.trip ?? 'open', cooldown_min: b.cooldownMin, run, next: `брейкер open, черга зупинена; наступна спроба — пробна задача через ${b.cooldownMin} хв` });
      console.log(`БРЕЙКЕР ВІДКРИТО: ${b.trip}. Черга зупинена; пробна задача — не раніше ніж через ${b.cooldownMin} хв.`);
    }
  } finally {
    git(['worktree', 'remove', tree, '--force']);
    currentTree = null;
  }
  if (opened) break;
}


// Ізоляція: основний checkout після прогону має лишитися без змін, крім нових тек docs/lab3/runs/.
const dirty = dirtyOf();
console.log(dirty.length === 0 ? 'основний checkout: чистий (крім docs/lab3/runs/, .harness/, stop-log)' : `УВАГА, основний checkout змінено:\n${dirty.join('\n')}`);
