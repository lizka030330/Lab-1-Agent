/**
 * Черга фабрики (Лаб. 3, крок 00): одна задача (--id) або всі. Готує git worktree і прибирає після себе.
 *   npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-01 [--no-push]
 * Дерево — від поточного коміту (HEAD), на окремій гілці harness/<id>-<мітка>: так повторний прогін
 * тієї самої задачі не конфліктує з попередньою гілкою.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { opencodeRunner, OPENCODE_MODEL, runTask, type Task } from './run-task';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.jsonl')) ?? 'docs/lab3/tasks.jsonl';
const onlyId = args.includes('--id') ? (args[args.indexOf('--id') + 1] ?? null) : null;
const push = !args.includes('--no-push');

const tasks: Task[] = readFileSync(file, 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Task)
  .filter((t) => onlyId === null || t.id === onlyId);

if (tasks.length === 0) throw new Error(`у ${file} немає задач${onlyId ? ` з id ${onlyId}` : ''}`);

const ROOT = resolve('.');
const git = (a: string[], cwd = ROOT) => execFileSync('git', a, { cwd, encoding: 'utf8' });
// Нові теки docs/lab3/runs/ від попередніх прогонів не заважають: дерево береться від HEAD, а вони в нього не потрапляють.
const dirtyBefore = git(['status', '--porcelain']).split('\n').filter((l) => l.trim() !== '' && !l.includes('docs/lab3/runs/'));
if (dirtyBefore.length > 0) {
  throw new Error(`основний checkout не чистий: закомітьте зміни, інакше дерево прогону не побачить їх\n${dirtyBefore.join('\n')}`);
}

for (const task of tasks) {
  const stamp = Date.now();
  const branch = `harness/${task.id}-${stamp}`;
  const tree = resolve(ROOT, '..', 'harness-runs', `${task.id}-${stamp}`);
  git(['worktree', 'add', '-b', branch, tree, 'HEAD']);
  try {
    // залежності — посиланням на основне дерево (у .gitignore як «node_modules»)
    if (!existsSync(join(tree, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'));
    const rec = runTask(task, { runner: opencodeRunner, agentPath: `opencode+${OPENCODE_MODEL}`, worktree: tree, outDir: join(ROOT, 'runs') });
    // відібраний артефакт — у репозиторій; сира runs/ лишається в .gitignore
    const keep = join(ROOT, 'docs', 'lab3', 'runs', `${task.id}-${new Date(rec.started_at).getTime()}`);
    mkdirSync(keep, { recursive: true });
    cpSync(rec.artifact_dir, keep, { recursive: true });
    // зміни агента — комітом на гілці прогону (runTask уже зробив git add -A)
    const staged = git(['diff', '--cached', '--name-only'], tree).trim();
    if (staged !== '') {
      git(['commit', '-m', `harness: ${task.id} (${rec.exit_status}, acceptance ${rec.acceptance_passed ? 'pass' : 'fail'})`], tree);
      if (push) git(['push', '-u', 'origin', branch], tree);
    }
    console.log(`${task.id}: ${rec.exit_status}, ${rec.duration_s} с, acceptance ${rec.acceptance_passed ? 'pass' : 'fail'}, змінено файлів: ${staged === '' ? 0 : staged.split('\n').length} → ${keep}`);
  } finally {
    git(['worktree', 'remove', tree, '--force']);
  }
}

// Ізоляція: основний checkout після прогону має лишитися без змін, крім нових тек docs/lab3/runs/.
const dirty = git(['status', '--porcelain']).split('\n').filter((l) => l.trim() !== '' && !l.includes('docs/lab3/runs/'));
console.log(dirty.length === 0 ? 'основний checkout: чистий (крім нових docs/lab3/runs/)' : `УВАГА, основний checkout змінено:\n${dirty.join('\n')}`);
