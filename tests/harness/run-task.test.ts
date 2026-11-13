import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readMeta, runTask, type AgentRunner, type Task } from '../../scripts/harness/run-task';

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
  it('пише журнал і артефакт на успішному прогоні; журнал вказує на свою теку', () => {
    const rec = runTask(task, {
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

  it('пише журнал навіть коли агент упав', () => {
    const rec = runTask(task, { runner: fake(1, '', 'boom'), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(rec.exit_status).toBe('agent_failed');
    expect(rec.acceptance_passed).toBe(false);
    expect(readFileSync(join(rec.artifact_dir, 'agent.log'), 'utf8')).toContain('boom');
  });

  it('пише журнал, навіть коли runner кинув виняток', () => {
    const throwing: AgentRunner = () => {
      throw new Error('spawn opencode ENOENT');
    };
    const rec = runTask(task, { runner: throwing, agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(rec.exit_status).toBe('agent_failed');
    expect(readFileSync(join(rec.artifact_dir, 'agent.log'), 'utf8')).toContain('ENOENT');
  });

  it('відрізняє вичерпаний бюджет і таймаут від падіння', () => {
    const budget = runTask(task, { runner: fake(1, '', 'Budget limit reached'), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(budget.exit_status).toBe('budget_or_turns');
    const timeout = runTask(task, { runner: fake(1, '', '', true), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(timeout.exit_status).toBe('timeout');
  });

  it('агент упорався в нуль ходів: журнал є, порожній patch, acceptance вирішує', () => {
    const rec = runTask(task, { runner: fake(0, ''), agentPath: 'fake', worktree: tmp(), outDir: tmp(), check: fail });
    expect(rec.exit_status).toBe('ok');
    expect(readFileSync(join(rec.artifact_dir, 'patch.diff'), 'utf8')).toBe('');
    expect(rec.acceptance_passed).toBe(false);
    expect(rec.session_id).toBeNull();
  });

  it('не падає на непарсибельному виводі; події OpenCode (JSON-рядки) читаються', () => {
    expect(readMeta('не JSON').cost_usd_estimate).toBeNull();
    const events = [
      JSON.stringify({ type: 'step_start', sessionID: 'ses_1' }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 100, output: 20 }, cost: 0 } }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 50, output: 5 }, cost: 0 } }),
    ].join('\n');
    expect(readMeta(events)).toEqual({ session_id: 'ses_1', input_tokens: 150, output_tokens: 25, cost_usd_estimate: 0 });
  });
});
