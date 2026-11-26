/**
 * Харнес Лаб. 3 по ЧУЖОМУ коду (Лаб. 4, брама «харнес прогнався по чужому коду»):
 *   npx tsx scripts/harness/run-queue.ts docs/lab4/foreign-tasks.jsonl --repo ../path-to-regexp --id f-01
 *
 * Той самий виконавець (runTask: OpenCode, брами-команди приймання, класифікація виходу, журнал run.json),
 * але дерево прогону — git worktree ЧУЖОГО репозиторію від його HEAD. Чого тут НЕМАЄ свідомо:
 * - коміту й пушу у форк: дерево й гілка прибираються, зміна агента лишається лише як patch.diff;
 * - копій чужого коду в курсовому репозиторії: у docs/lab4/traces/foreign/ іде тільки журнал run.json;
 *   повні output.txt / agent.log / patch.diff (у них фрагменти чужого коду) — у форк, reports/lab4/harness/;
 * - конфігурації агента в самому форку: агент `harness` приходить через OPENCODE_CONFIG
 *   (docs/lab4/opencode-harness-foreign.json) — форк не змінюється заради харнеса.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { trace } from '@opentelemetry/api';

import { opencodeRunner, OPENCODE_MODEL, runTask, type Task } from './run-task';

export async function runForeignQueue(tasks: readonly Task[], repoArg: string, root: string): Promise<void> {
  const repo = resolve(repoArg);
  const git = (a: string[], cwd = repo) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  const dirty = git(['status', '--porcelain']).split('\n').filter((l) => l.trim() !== '' && !l.includes('reports/lab4/harness/'));
  if (dirty.length > 0) throw new Error(`чужий репозиторій не чистий:\n${dirty.join('\n')}`);
  process.env.OPENCODE_CONFIG = join(root, 'docs', 'lab4', 'opencode-harness-foreign.json');
  const head = git(['rev-parse', 'HEAD']).trim();
  const remote = git(['config', '--get', 'remote.origin.url']).trim();
  console.log(`чужий репозиторій: ${remote} @ ${head.slice(0, 7)}; агент: opencode+${OPENCODE_MODEL}; конфіг: ${process.env.OPENCODE_CONFIG.slice(root.length + 1)}`);

  for (const task of tasks) {
    const stamp = Date.now();
    const branch = `harness/foreign/${task.id}-${stamp}`;
    const tree = resolve(repo, '..', 'harness-runs', 'foreign', `${task.id}-${stamp}`);
    git(['worktree', 'add', '-b', branch, tree, 'HEAD']);
    try {
      if (!existsSync(join(tree, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(tree, 'node_modules'));
      const rec = await trace.getTracer('harness').startActiveSpan(`task ${task.id} foreign`, async (span) => {
        try {
          const ctx = span.spanContext();
          const traceId = /[^0]/.test(ctx.traceId) ? ctx.traceId : null;
          return await runTask(task, { runner: opencodeRunner, agentPath: `opencode+${OPENCODE_MODEL}`, worktree: tree, outDir: join(root, 'runs'), traceId });
        } finally {
          span.end();
        }
      });
      const name = `${task.id}-${new Date(rec.started_at).getTime()}`;
      // журнал прогону — у курсовий репозиторій (без чужого коду)
      const journal = join(root, 'docs', 'lab4', 'traces', 'foreign', name);
      mkdirSync(journal, { recursive: true });
      cpSync(join(rec.artifact_dir, 'run.json'), join(journal, 'run.json'));
      // повні артефакти — у форк (там чужий код)
      const full = join(repo, 'reports', 'lab4', 'harness', name);
      mkdirSync(full, { recursive: true });
      cpSync(rec.artifact_dir, full, { recursive: true });
      console.log(`${task.id}: ${rec.exit_status}, ${rec.duration_s} с, acceptance ${rec.acceptance_passed ? 'pass' : 'fail'}`);
      for (const a of rec.acceptance) console.log(`  ${a.exit === 0 ? '✓' : '✗'} ${a.cmd}`);
      console.log(`  журнал: ${join(journal, 'run.json').slice(root.length + 1)}\n  артефакти: ${full}`);
    } finally {
      git(['worktree', 'remove', tree, '--force']);
      git(['branch', '-D', branch]);
    }
  }
}
