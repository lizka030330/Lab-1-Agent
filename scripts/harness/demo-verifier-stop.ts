/**
 * НАВМИСНА ДЕМОНСТРАЦІЯ зупинки верифікатором (Лаб. 3, крок 02, зібрано на кроці 08).
 * Зміну пише ЛЮДИНА (цей скрипт), а не агент: за 13 зелених прогонів агента 13–16.11 суддя жодного разу
 * не мав справжнього порушення (docs/lab3/verifier.md, «Справжня зупинка»). Так само як `harness/red-2026-11-14`
 * для брами types і `test/eval-gate-demo` для брами evals.
 *
 *   npx tsx scripts/harness/demo-verifier-stop.ts wrong   — JSDoc є (acceptance t-08 проходить), але зміст хибний
 *   npx tsx scripts/harness/demo-verifier-stop.ts fixed   — той самий коміт, виправлений зміст
 *
 * Обидва: окремий git worktree від HEAD на гілці demo/verifier-<варіант>-<мітка>, справжній запуск команд
 * acceptance t-08, артефакт у docs/lab3/runs/demo-verifier-<варіант>-<мітка>/ у форматі харнеса. Потім:
 *   npm run verify:harness -- docs/lab3/runs/demo-verifier-<варіант>-<мітка>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { checkAcceptance, type RunRecord, type Task } from './run-task';

const variant = process.argv[2];
if (variant !== 'wrong' && variant !== 'fixed') throw new Error('варіант: wrong або fixed');

const COMMENTS = {
  // хибний зміст: обидва твердження суперечать коду src/cost.ts
  wrong: ['/** Максимальний облік: усі три лічильники дорівнюють Infinity. */', '/** Повертає різницю двох Usage: a мінус b за кожним полем. */'],
  // правильний зміст, як вимагає критерій C1 t-08
  fixed: ['/** Нульовий облік: inputTokens, cachedTokens і outputTokens дорівнюють 0. */', '/** Поелементна сума двох Usage: inputTokens, cachedTokens і outputTokens складаються окремо. */'],
} as const;

const ROOT = resolve('.');
const git = (a: string[], cwd = ROOT) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const task = readFileSync('docs/lab3/tasks.jsonl', 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Task).find((t) => t.id === 't-08');
if (!task) throw new Error('немає t-08');

const stamp = Date.now();
const branch = `demo/verifier-${variant}-${stamp}`;
const tree = resolve(ROOT, '..', 'harness-runs', `demo-verifier-${variant}-${stamp}`);
git(['worktree', 'add', '-q', '-b', branch, tree, 'HEAD']);
try {
  if (!existsSync(join(tree, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'));
  const file = join(tree, 'src', 'cost.ts');
  const [z, a] = COMMENTS[variant];
  const src = readFileSync(file, 'utf8')
    .replace('export const ZERO_USAGE', `${z}\nexport const ZERO_USAGE`)
    .replace('export function addUsage', `${a}\nexport function addUsage`);
  writeFileSync(file, src, 'utf8');

  const started = new Date();
  const acceptance = checkAcceptance(task, tree);
  const ended = new Date();
  git(['add', '-A', '--', '.', ':(exclude).agent-log'], tree);
  const patch = git(['diff', '--cached'], tree);
  git(['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', 'commit', '-q', '-m',
    `ДЕМО (людина, не агент): JSDoc t-08 — ${variant === 'wrong' ? 'хибний зміст' : 'виправлений зміст'}`], tree);

  const dir = join(ROOT, 'docs', 'lab3', 'runs', `demo-verifier-${variant}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'patch.diff'), patch, 'utf8');
  writeFileSync(join(dir, 'output.txt'), `ДЕМОНСТРАЦІЯ: зміну написала людина скриптом scripts/harness/demo-verifier-stop.ts (${variant}), агент не запускався.\n`, 'utf8');
  const record: RunRecord = {
    task_id: task.id,
    agent_path: 'human-demo (scripts/harness/demo-verifier-stop.ts)',
    artifact_dir: dir,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    duration_s: Math.round((ended.getTime() - started.getTime()) / 100) / 10,
    exit_status: 'ok',
    acceptance,
    acceptance_passed: acceptance.length > 0 && acceptance.every((x) => x.exit === 0),
    session_id: null, input_tokens: null, output_tokens: null, cost_usd_estimate: null,
    trace_id: null,
    gates: {},
  } as RunRecord;
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`гілка ${branch}\nartefact ${dir}\nacceptance: ${acceptance.map((x) => `${x.exit}`).join(' ')} → ${record.acceptance_passed ? 'pass' : 'FAIL'}`);
  console.log(`далі: npm run verify:harness -- docs/lab3/runs/demo-verifier-${variant}-${stamp}`);
} finally {
  git(['worktree', 'remove', '--force', tree]);
}
