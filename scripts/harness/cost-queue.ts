/**
 * Режим аудиту вартості черги (Лаб. 4, крок 07): `run-queue.ts <tasks.jsonl> --config <A-cheap-escalate|B-strong> [--ids t-01,t-03]`.
 *
 * Відмінності від звичайної черги Лаб. 3 — лише ті, без яких порівняння двох конфігурацій не чесне:
 * - модель обирає конфігурація, а не HARNESS_MODEL;
 * - гілка і тека прогону — ПЕР-КОНФІГУРАЦІЙНІ (harness/<config>/<id>-<мітка>), кожна спроба — у свіжому дереві від HEAD;
 * - підняття (A): дешева модель першою; якщо критерії приймання не пройшли — сильніша з чистого дерева,
 *   і в запис ідуть токени ОБОХ спроб;
 * - брейкер Лаб. 3 НЕ зупиняє чергу: обидві конфігурації мусять пройти той самий банк до кінця.
 *   Межі самої задачі (кроки агента, timeout_s) діють як і раніше;
 * - нічого не комітиться й не пушиться: дерево і гілка прибираються після кожної спроби,
 *   артефакти — у docs/lab4/traces/cost-runs/<config>/, запис задачі — рядком у docs/lab4/traces/cost-<config>.jsonl.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { trace } from '@opentelemetry/api';

import { readLog, readUsage, toTaskCost, type Attempt } from './cost';
import { opencodeRunnerFor, runTask, type Task } from './run-task';

export const CHEAP = process.env.HARNESS_CHEAP || 'google/gemini-3.5-flash-lite';
export const STRONG = process.env.HARNESS_STRONG || 'google/gemini-3.8-flash';

export const CONFIGS: Record<string, readonly string[]> = {
  // дешева першою, сильніша — лише там, де детерміновані брами (критерії приймання) впали
  'A-cheap-escalate': [CHEAP, STRONG],
  // одна сильніша завжди
  'B-strong': [STRONG],
};

export async function runCostQueue(tasks: readonly Task[], config: string, root: string): Promise<void> {
  const models = CONFIGS[config];
  if (!models) throw new Error(`невідома конфігурація ${config}; є: ${Object.keys(CONFIGS).join(', ')}`);
  const git = (a: string[], cwd = root) => execFileSync('git', a, { cwd, encoding: 'utf8' });
  const outJsonl = join(root, 'docs', 'lab4', 'traces', `cost-${config}.jsonl`);
  const keepRoot = join(root, 'docs', 'lab4', 'traces', 'cost-runs', config);
  mkdirSync(keepRoot, { recursive: true });
  const tracer = trace.getTracer('harness');
  console.log(`конфігурація ${config}: ${models.join(' → ')}; задач ${tasks.length}; HEAD ${git(['rev-parse', '--short', 'HEAD']).trim()}`);

  for (const task of tasks) {
    const attempts: Attempt[] = [];
    let traceId: string | null = null;
    await tracer.startActiveSpan(`task ${task.id} ${config}`, async (span) => {
      try {
        const ctx = span.spanContext();
        traceId = /[^0]/.test(ctx.traceId) ? ctx.traceId : null;
        for (const [i, model] of models.entries()) {
          const stamp = Date.now();
          const branch = `harness/${config}/${task.id}-${stamp}`;
          const tree = resolve(root, '..', 'harness-runs', config, `${task.id}-${stamp}`);
          git(['worktree', 'add', '-b', branch, tree, 'HEAD']);
          try {
            if (!existsSync(join(tree, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(tree, 'node_modules'));
            const rec = await runTask(task, { runner: opencodeRunnerFor(model), agentPath: `opencode+${model}`, worktree: tree, outDir: join(root, 'runs'), traceId });
            const keep = join(keepRoot, `${task.id}-a${i + 1}-${new Date(rec.started_at).getTime()}`);
            mkdirSync(keep, { recursive: true });
            cpSync(rec.artifact_dir, keep, { recursive: true });
            const stdout = readFileSync(join(rec.artifact_dir, 'output.txt'), 'utf8');
            const stderr = readFileSync(join(rec.artifact_dir, 'agent.log'), 'utf8');
            const u = readUsage(stdout);
            const log = readLog(stderr);
            attempts.push({
              model, usage: u.usage, steps: u.steps, tool_calls: u.tool_calls, retries: log.retries, title_calls: log.title_calls,
              duration_s: rec.duration_s, passed: rec.acceptance_passed, exit_status: rec.exit_status,
              artifact: keep.slice(root.length + 1),
            });
            console.log(`${task.id} [${config}] спроба ${i + 1} ${model}: ${rec.exit_status}, ${rec.duration_s} с, acceptance ${rec.acceptance_passed ? 'pass' : 'fail'}, кроків ${u.steps}, вхід ${u.usage.input ?? '—'}, вихід ${u.usage.output ?? '—'}`);
            if (rec.acceptance_passed) break; // підняття лише там, де брами впали
          } finally {
            git(['worktree', 'remove', tree, '--force']);
            git(['branch', '-D', branch]);
          }
        }
      } finally {
        span.end();
      }
    });
    const row = toTaskCost({ task_id: task.id, config, trace_id: traceId }, attempts);
    appendFileSync(outJsonl, `${JSON.stringify(row)}\n`, 'utf8');
  }
  console.log(`записи: ${outJsonl.slice(root.length + 1)}`);
}
