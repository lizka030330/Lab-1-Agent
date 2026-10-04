// tests/agent-aisdk.test.ts — без мережі: модель підроблена, файлова система теж
import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { createAgent, runWithApproval } from '../src/agent/agent-aisdk';

type GenResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const toolCall = (toolName: string, input: object, id: string): GenResult => ({
  content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls', raw: undefined },
  usage,
  warnings: [],
});
const text = (t: string): GenResult => ({
  content: [{ type: 'text', text: t }],
  finishReason: { unified: 'stop', raw: undefined },
  usage,
  warnings: [],
});
const fakeFs = () => ({
  list: vi.fn(async () => ['a.txt']),
  read: vi.fn(async () => 'hi'),
  write: vi.fn(async () => {}),
});

describe('agent-aisdk: ToolLoopAgent (AI SDK 7)', () => {
  it.each([
    { approved: false, writes: 0 },
    { approved: true, writes: 1 },
  ])('write_file виконується лише після схвалення: $approved', async ({ approved, writes }) => {
    const fs = fakeFs();
    const model = new MockLanguageModelV4({
      doGenerate: [toolCall('write_file', { path: 'a.txt', content: 'x' }, 'c1'), text('{"summary":"ok","written":[]}')],
    });
    const ask = vi.fn(async () => approved);
    const run = await runWithApproval(createAgent(model, fs), 'запиши a.txt', ask);
    expect(run.first.content.some((p) => p.type === 'tool-approval-request')).toBe(true);
    expect(run.first.steps).toHaveLength(1); // агент зупинився на запиті, інструмент не виконано
    expect(ask).toHaveBeenCalledWith('write_file', { path: 'a.txt', content: 'x' });
    expect(fs.write).toHaveBeenCalledTimes(writes);
    expect(run.final.output).toEqual({ summary: 'ok', written: [] });
    expect(run.inputTokens).toBe(20);
  });

  it('зупиняється на ліміті кроків і сумує usage', async () => {
    const fs = fakeFs();
    let n = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => toolCall('list_files', { dir: '.' }, `c${n++}`) });
    const result = await createAgent(model, fs, 3).generate({ prompt: 'крутись вічно' });
    expect(result.steps).toHaveLength(3);
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(fs.list).toHaveBeenCalledTimes(3);
    expect(result.steps.map((s) => s.usage.inputTokens)).toEqual([10, 10, 10]);
    expect(result.usage.inputTokens).toBe(30);
    expect(() => result.output).toThrow(); // останній крок — tool-calls, структурованого виходу немає
  });
});