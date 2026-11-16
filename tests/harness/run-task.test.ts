import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classify, readMeta, runTask, spawnAgent, type AgentRunner, type Task } from '../../scripts/harness/run-task';

const task: Task = {
  id: 't-01',
  input: 'нічого не робити',
  acceptance: ['npm run typecheck'],
  budget: { max_turns: 2, max_usd: 0, timeout_s: 30 },
};

const fake =
  (exitCode: number, stdout = '', stderr = '', timedOut = false): AgentRunner =>
  () => ({ exitCode, stdout, stderr, timedOut });
const tmp = () => mkdtempSync(join(tmpdir(), 'harness-'));
// acceptance не запускаємо справжніх команд: тест перевіряє виконавця, а не репозиторій
const pass = () => [{ cmd: 'npm run typecheck', exit: 0 }];
const fail = () => [{ cmd: 'npm run typecheck', exit: 2 }];

describe('runTask (крок 00, без мережі й без ключів)', () => {
  it('пише журнал і артефакт на успішному прогоні; журнал вказує на свою теку', async () => {
    const rec = await runTask(task, {
      runner: fake(0, JSON.stringify({ session_id: 'abc', total_cost_usd: 0.004, usage: { input_tokens: 10, output_tokens: 5 } })),
      agentPath: 'fake',
      worktree: tmp(),
      outDir: tmp(),
      check: pass,
    });
    expect(rec.exit_status).toBe('ok');
    expect(rec.session_id).toBe('abc');
    expect(rec.cost_usd_estimate).toBe(0.004);
    expect(rec.input_tokens).toBe(10);
    expect(rec.acceptance_passed).toBe(true);
    for (const f of ['patch.diff', 'output.txt', 'agent.log', 'run.json']) {
      expect(() => readFileSync(join(rec.artifact_dir, f), 'utf8')).not.toThrow();
    }
    const saved = JSON.parse(readFileSync(join(rec.artifact_dir, 'run.json'), 'utf8')) as { task_id: string; artifact_dir: string };
    expect(saved.task_id).toBe('t-01');
    expect(saved.artifact_dir).toBe(rec.artifact_dir);
  });

  it('пише журнал навіть коли агент упав', async () => {
    const rec = await runTask(task, { runner: fake(1, '', 'boom'), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(rec.exit_status).toBe('agent_failed');
    expect(rec.acceptance_passed).toBe(false);
    expect(readFileSync(join(rec.artifact_dir, 'agent.log'), 'utf8')).toContain('boom');
  });

  it('пише журнал, навіть коли runner кинув виняток', async () => {
    const throwing: AgentRunner = () => {
      throw new Error('spawn opencode ENOENT');
    };
    const rec = await runTask(task, { runner: throwing, agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(rec.exit_status).toBe('agent_failed');
    expect(readFileSync(join(rec.artifact_dir, 'agent.log'), 'utf8')).toContain('ENOENT');
  });

  it('відрізняє вичерпаний бюджет і таймаут від падіння', async () => {
    const budget = await runTask(task, { runner: fake(1, '', 'Budget limit reached'), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(budget.exit_status).toBe('budget_or_turns');
    const quota = await runTask(task, {
      runner: fake(1, '{"type":"error","error":{"data":{"message":"You exceeded your current quota, please check your plan"}}}'),
      agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail,
    });
    expect(quota.exit_status).toBe('quota'); // крок 03: квота — окремий клас, умова брейкера
    const timeout = await runTask(task, { runner: fake(1, '', '', true), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(timeout.exit_status).toBe('timeout');
  });

  it('агент упорався в нуль ходів: журнал є, порожній patch, acceptance вирішує', async () => {
    const rec = await runTask(task, { runner: fake(0, ''), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(rec.exit_status).toBe('ok');
    expect(readFileSync(join(rec.artifact_dir, 'patch.diff'), 'utf8')).toBe('');
    expect(rec.acceptance_passed).toBe(false);
    expect(rec.session_id).toBeNull();
  });

  it('не падає на непарсибельному виводі; події OpenCode (JSON-рядки) читаються', async () => {
    expect(readMeta('не JSON').cost_usd_estimate).toBeNull();
    const events = [
      JSON.stringify({ type: 'step_start', sessionID: 'ses_1' }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 100, output: 20 }, cost: 0 } }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 50, output: 5 }, cost: 0 } }),
    ].join('\n');
    expect(readMeta(events)).toEqual({ session_id: 'ses_1', input_tokens: 150, output_tokens: 25, cost_usd_estimate: 0 });
  });
});

describe('spawnAgent (крок 03, шар задачі): зупинювачі харнеса на справжньому процесі', () => {
  const node = process.execPath;
  it('таймаут за годинником стіни вбиває процес, що не завершується сам', async () => {
    const t0 = Date.now();
    const res = await spawnAgent(node, ['-e', 'setTimeout(() => {}, 60_000)'], tmp(), 0.3, 50);
    expect(res.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(classify(res)).toBe('timeout');
  });

  it('перша відмова за квотою вбиває агента одразу, без повторів', async () => {
    const script = 'console.error("You exceeded your current quota, please check your plan"); setTimeout(() => {}, 60_000)';
    const res = await spawnAgent(node, ['-e', script], tmp(), 30, 50);
    expect(res.quotaStop).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(classify(res)).toBe('quota');
  });

  it('звичайний процес завершується сам — жоден зупинювач не спрацював', async () => {
    const res = await spawnAgent(node, ['-e', 'console.log("ok")'], tmp(), 30, 50);
    expect(res).toMatchObject({ exitCode: 0, timedOut: false, quotaStop: false });
    expect(res.stdout.trim()).toBe('ok');
  });
});
