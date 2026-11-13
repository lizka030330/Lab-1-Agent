/**
 * Виконавець фабрики задач (Лаб. 3, крок 00).
 * Один виклик = одна задача = один артефакт (patch.diff, output.txt, agent.log) + один журнал run.json.
 * Виконавець не має власного інтелекту: запуск агента — параметр runner, тому тест працює без мережі.
 * Шлях агента: OpenCode + Ollama (docs/lab3/factory.md).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Task {
  readonly id: string;
  readonly input: string;
  readonly acceptance: readonly string[];
  readonly budget: { readonly max_turns: number; readonly max_usd: number; readonly timeout_s: number };
  readonly files?: readonly string[];
}

export interface AgentResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** true, якщо процес убив таймаут, а не агент завершився сам */
  readonly timedOut: boolean;
}

/** Запуск агента. У тестах підмінюється підставним. */
export type AgentRunner = (task: Task, cwd: string) => AgentResult;

export type ExitStatus = 'ok' | 'agent_failed' | 'timeout' | 'budget_or_turns';

export interface RunRecord {
  readonly task_id: string;
  readonly agent_path: string;
  readonly artifact_dir: string;
  readonly started_at: string;
  readonly ended_at: string;
  readonly duration_s: number;
  readonly exit_status: ExitStatus;
  readonly acceptance: readonly { readonly cmd: string; readonly exit: number }[];
  readonly acceptance_passed: boolean;
  readonly session_id: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cost_usd_estimate: number | null;
  readonly trace_id: string | null; // крок 06
  readonly gates: Record<string, 'pass' | 'fail' | 'skipped'>; // крок 01
}

/** Модель агента: локальна, з контекстом 16k (scripts/harness/Modelfile). */
export const OPENCODE_MODEL = 'ollama/qwen3-8b-16k';

/** Спільна обвʼязка процесу: таймаут задачі тримає сам процес. */
function spawnAgent(bin: string, args: readonly string[], cwd: string, timeoutS: number): AgentResult {
  const r = spawnSync(bin, [...args], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutS * 1000,
    killSignal: 'SIGINT', // дає агентові завершити хід
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT',
  };
}

/**
 * Безкоштовний шлях: OpenCode + Ollama. Прапорці — рівно з `opencode run --help` (1.18.34):
 * -m provider/model, --format json (сирі події JSON), --agent harness (звужені дозволи), --dir (тека прогону).
 * `--auto` НЕ передаємо: він автоматично схвалює все незаборонене — це обхід дозволів.
 */
export const opencodeRunner: AgentRunner = (task, cwd) =>
  spawnAgent(
    'opencode',
    ['run', task.input, '-m', OPENCODE_MODEL, '--format', 'json', '--agent', 'harness', '--dir', resolve(cwd)],
    cwd,
    task.budget.timeout_s,
  );

/** Вивід OpenCode з --format json — рядки JSON-подій. Рядки, що не парсяться, пропускаємо. */
export function parseEvents(stdout: string): unknown[] {
  const out: unknown[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* не JSON — пропускаємо */
    }
  }
  return out;
}

/** Обхід дерева значень: кожен обʼєкт віддає у visit. */
function walk(v: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(v)) v.forEach((x) => walk(x, visit));
  else if (v !== null && typeof v === 'object') {
    visit(v as Record<string, unknown>);
    Object.values(v as Record<string, unknown>).forEach((x) => walk(x, visit));
  }
}

/**
 * session_id, токени й вартість з подій агента. Назви полів OpenCode зчитано з першого прогону
 * і записано у factory.md; підтримано й форму Claude Code (session_id, usage, total_cost_usd) —
 * її використовує тест. Чого немає — null, а не вигадане число.
 */
export function readMeta(stdout: string): Pick<RunRecord, 'session_id' | 'input_tokens' | 'output_tokens' | 'cost_usd_estimate'> {
  let session: string | null = null;
  let input: number | null = null;
  let output: number | null = null;
  let cost: number | null = null;
  const add = (a: number | null, b: unknown) => (typeof b === 'number' ? (a ?? 0) + b : a);
  for (const ev of parseEvents(stdout)) {
    walk(ev, (o) => {
      if (session === null) {
        const s = o.sessionID ?? o.session_id;
        if (typeof s === 'string' && s !== '') session = s;
      }
      // OpenCode: { tokens: { input, output, … }, cost } у події кінця кроку
      if (o.tokens !== null && typeof o.tokens === 'object') {
        const t = o.tokens as Record<string, unknown>;
        input = add(input, t.input);
        output = add(output, t.output);
        if ('cost' in o) cost = add(cost, o.cost);
      }
      // Claude Code: { usage: { input_tokens, output_tokens }, total_cost_usd }
      if (o.usage !== null && typeof o.usage === 'object') {
        const u = o.usage as Record<string, unknown>;
        input = add(input, u.input_tokens);
        output = add(output, u.output_tokens);
      }
      if (typeof o.total_cost_usd === 'number') cost = add(cost, o.total_cost_usd);
    });
  }
  return { session_id: session, input_tokens: input, output_tokens: output, cost_usd_estimate: cost };
}

/** Межа ходів чи бюджету — не падіння. Рядки розпізнавання — дослівно з виводу агента (factory.md). */
const BUDGET_MARKERS = [/Budget limit reached/i, /max(imum)? (turns|steps)/i];

export function classify(res: AgentResult): ExitStatus {
  if (res.timedOut) return 'timeout';
  if (res.exitCode === 0) return 'ok';
  const text = `${res.stdout}\n${res.stderr}`;
  return BUDGET_MARKERS.some((re) => re.test(text)) ? 'budget_or_turns' : 'agent_failed';
}

/** Критерії приймання — це КОМАНДИ. Виконуємо їх у дереві прогону. */
export function checkAcceptance(task: Task, cwd: string): { cmd: string; exit: number }[] {
  return task.acceptance.map((cmd) => {
    const r = spawnSync(cmd, { cwd, encoding: 'utf8', shell: true, timeout: task.budget.timeout_s * 1000 });
    return { cmd, exit: r.status ?? 1 };
  });
}

export function runTask(
  task: Task,
  opts: { runner: AgentRunner; agentPath: string; worktree: string; outDir: string; check?: typeof checkAcceptance },
): RunRecord {
  const dir = join(opts.outDir, `${task.id}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const started = new Date();

  // Навіть якщо runner кинув виняток — журнал має бути.
  let res: AgentResult;
  try {
    res = opts.runner(task, opts.worktree);
  } catch (e) {
    res = { exitCode: 1, stdout: '', stderr: `runner кинув виняток: ${String(e)}`, timedOut: false };
  }

  // Артефакт: спершу git add -A, бо `git diff` без індексу не показує нових файлів.
  // .agent-log/ виключено: хук журналу OpenCode дописує його в КОЖНОМУ прогоні — це не зміна задачі
  // (перший прогін t-02 приніс цей файл у patch.diff поруч із тестом).
  let patch = '';
  const quiet = { cwd: opts.worktree, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };
  try {
    execFileSync('git', ['add', '-A', '--', '.', ':(exclude).agent-log'], quiet);
    patch = execFileSync('git', ['diff', '--cached'], { ...quiet, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    patch = '';
  }
  writeFileSync(join(dir, 'patch.diff'), patch, 'utf8');
  writeFileSync(join(dir, 'output.txt'), res.stdout, 'utf8');
  writeFileSync(join(dir, 'agent.log'), res.stderr, 'utf8');

  const acceptance = (opts.check ?? checkAcceptance)(task, opts.worktree);
  const ended = new Date();
  const record: RunRecord = {
    task_id: task.id,
    agent_path: opts.agentPath,
    artifact_dir: dir, // ← звʼязок журналу з артефактом
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    duration_s: Math.round((ended.getTime() - started.getTime()) / 100) / 10,
    exit_status: classify(res),
    acceptance,
    acceptance_passed: acceptance.length > 0 && acceptance.every((a) => a.exit === 0),
    ...readMeta(res.stdout),
    trace_id: null, // ← крок 06
    gates: {}, // ← крок 01
  };
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}
