import { describe, expect, it } from 'vitest';

import { readLog, readUsage, summarise, taskRow, toTaskCost, type Attempt } from '../../scripts/harness/cost';

const step = (input: number, output: number, reasoning: number, read: number, cost: number) =>
  JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', tokens: { total: 0, input, output, reasoning, cache: { write: 0, read } }, cost } });

describe('readUsage — сума step_finish (аналог totalUsage), а не останній крок', () => {
  it('сумує всі кроки і рахує виклики інструментів', () => {
    const out = [step(100, 10, 5, 0, 0.001), '{"type":"tool_use","part":{"type":"tool"}}', step(200, 20, 0, 150, 0.002), 'не json'].join('\n');
    const r = readUsage(out);
    expect(r).toMatchObject({ steps: 2, tool_calls: 1 });
    expect(r.usage).toEqual({ input: 300, output: 30, reasoning: 5, cache_read: 150, cache_write: 0, cost_usd: 0.003 });
  });
  it('без подій — null, а не 0', () => {
    expect(readUsage('').usage).toEqual({ input: null, output: null, reasoning: null, cache_read: null, cache_write: null, cost_usd: null });
  });
  it('поле, якого агент не прислав, лишається null', () => {
    const out = JSON.stringify({ type: 'step_finish', part: { tokens: { input: 5, output: 1 } } });
    expect(readUsage(out).usage).toMatchObject({ input: 5, output: 1, reasoning: null, cache_read: null, cost_usd: null });
  });
});

describe('readLog — повтори з журналу, бо в трасі їх не видно', () => {
  it('рахує stream error агента і службові виклики заголовка окремо', () => {
    const log = [
      'level=INFO message=stream providerID=google modelID=x small=false agent=harness mode=primary',
      'level=ERROR message="stream error" providerID=google small=false agent=harness error.error="AI_RetryError"',
      'level=INFO message=stream providerID=google small=true agent=title mode=primary',
      'level=ERROR message="stream error" small=true agent=title',
    ].join('\n');
    expect(readLog(log)).toEqual({ model_calls: 1, retries: 1, title_calls: 1 });
  });
});

const att = (model: string, passed: boolean, input: number | null, output: number | null): Attempt => ({
  model, passed, exit_status: 'ok', artifact: 'x', steps: 3, tool_calls: 2, retries: 0, title_calls: 1, duration_s: 10,
  usage: { input, output, reasoning: null, cache_read: null, cache_write: null, cost_usd: null },
});

describe('toTaskCost і summarise', () => {
  it('підняття: токени ОБОХ спроб, результат — останньої', () => {
    const r = toTaskCost({ task_id: 't-10', config: 'A', trace_id: null }, [att('cheap', false, 100, 10), att('strong', true, 300, 30)]);
    expect(r).toMatchObject({ escalated: true, passed: true, input_tokens: 400, output_tokens: 40, reasoning_tokens: null, steps: 6, duration_s: 20, models: ['cheap', 'strong'] });
  });
  it('токени на пройдену й «повідомлено N/M»; без пройдених — null', () => {
    const rows = [
      toTaskCost({ task_id: 'a', config: 'B', trace_id: null }, [att('s', true, 100, 10)]),
      toTaskCost({ task_id: 'b', config: 'B', trace_id: null }, [att('s', false, null, null)]),
    ];
    const s = summarise(rows);
    expect(s).toMatchObject({ tasks: 2, passed: 1, pass_share: 0.5, input_tokens: 100, input_reported: '1/2', tokens_per_passed: 110, cache_read_reported: '0/2' });
    expect(summarise([rows[1]!]).tokens_per_passed).toBeNull();
  });
  it('у таблиці не повідомлене — словами, не нулем', () => {
    const r = toTaskCost({ task_id: 'b', config: 'B', trace_id: null }, [att('google/m', false, null, 5)]);
    expect(taskRow(r)).toContain('не повідомлено');
    expect(taskRow(r)).toContain('m ✗');
  });
});
