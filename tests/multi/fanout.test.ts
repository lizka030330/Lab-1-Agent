import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BUDGET } from '../../src/multi/budget';
import { fanOut, type Branch } from '../../src/multi/fanout';

type GenResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
const ok = (text: string): GenResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } },
  warnings: [],
});
const four: Branch[][] = [['history', 'module', 'tests', 'deps'].map((lane) => ({ lane, prompt: `p ${lane}` }))];
const log = () => join(mkdtempSync(join(tmpdir(), 'fan-')), 'budget-stop.jsonl');
const lines = (f: string) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

describe('fanOut (Лаб. 4, крок 03)', () => {
  it('у межах бюджету — усі 4 гілки, токени підсумовано, stop = none', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ok('факт') });
    const r = await fanOut({ model, readOnlyTools: {}, rounds: four, budget: DEFAULT_BUDGET, taskId: 't' });
    expect(r.stop).toBe('none');
    expect(r.out.map((o) => o.lane).sort()).toEqual(['deps', 'history', 'module', 'tests']);
    expect(r.spent).toMatchObject({ calls: 4, input: 40, output: 20, unreported: 0 });
  });

  it('стеля ходів нижче за кількість гілок — раунд не стартує, виклику моделі немає, рядок у журналі', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ok('факт') });
    const f = log();
    const r = await fanOut({ model, readOnlyTools: {}, rounds: four, budget: { ...DEFAULT_BUDGET, maxTurns: 3 }, taskId: 'q-stop', stopLog: f });
    expect(r.stop).toBe('turn-budget');
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(r.failed).toHaveLength(4);
    expect(lines(f)).toEqual([expect.objectContaining({ taskId: 'q-stop', limit: 'turn-budget', round: 0, where: 'перед раундом' })]);
  });

  it('стеля токенів спрацьовує на fan-in (раунд один — без другої перевірки вона б мовчала)', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ok('факт') });
    const f = log();
    const r = await fanOut({ model, readOnlyTools: {}, rounds: four, budget: { ...DEFAULT_BUDGET, tokenCeiling: 30 }, taskId: 'q-tok', stopLog: f });
    expect(r.stop).toBe('token-ceiling');
    expect(r.out).toHaveLength(4); // перевищення можливе на один раунд — чесне обмеження
    expect(lines(f)[0]).toMatchObject({ limit: 'token-ceiling', where: 'на fan-in' });
  });

  it('стеля часу скасовує гілки через AbortController; скасовані гілки списують хід', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: (o) =>
        new Promise<GenResult>((res, rej) => {
          const t = setTimeout(() => res(ok('пізно')), 500);
          o.abortSignal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); });
        }),
    });
    const r = await fanOut({ model, readOnlyTools: {}, rounds: four, budget: { ...DEFAULT_BUDGET, wallClockMs: 30 }, taskId: 'q-time', stopLog: log() });
    expect(r.stop).toBe('wall-clock');
    expect(r.out).toHaveLength(0);
    expect(r.failed).toHaveLength(4);
    expect(r.spent).toMatchObject({ calls: 4, unreported: 4 });
  });

  it('якщо гілка вичерпала кроки на інструменти — підсумок окремим запитом без інструментів, у межах stepsPerBranch', async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (o) =>
        (o.tools?.length ?? 0) === 0
          ? ok('підсумок смуги')
          : { ...ok(''), content: [{ type: 'tool-call', toolCallId: `c${n++}`, toolName: 'read_file', input: '{}' }], finishReason: { unified: 'tool-calls', raw: undefined } },
    });
    const { tool } = await import('ai');
    const { z } = await import('zod');
    const tools = { read_file: tool({ inputSchema: z.object({}), execute: async () => 'вміст файлу' }) };
    const r = await fanOut({ model, readOnlyTools: tools, rounds: [[{ lane: 'module', prompt: 'p' }]], budget: { ...DEFAULT_BUDGET, stepsPerBranch: 3 }, taskId: 't' });
    expect(r.out).toEqual([{ lane: 'module', text: 'підсумок смуги' }]);
    expect(r.lanes[0]).toMatchObject({ steps: 3, textChars: 'підсумок смуги'.length });
    expect(model.doGenerateCalls).toHaveLength(3); // 2 з інструментами + 1 підсумок
    expect(JSON.stringify(model.doGenerateCalls[2]?.prompt)).toContain('вміст файлу'); // виводи інструментів передано текстом
  });
});
