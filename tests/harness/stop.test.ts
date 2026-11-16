import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateText, hasToolCall, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { stepLimit } from '../../src/harness/stop';

type GenResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const call = (toolName: string, id: string): GenResult => ({
  content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify({ path: 'a.md' }) }],
  finishReason: { unified: 'tool-calls', raw: undefined },
  usage,
  warnings: [],
});
const tools = {
  read_file: tool({ inputSchema: z.object({ path: z.string() }), execute: async () => 'текст' }),
  submitArtifact: tool({ inputSchema: z.object({ path: z.string() }), execute: async () => 'прийнято' }),
};
const lines = (f: string) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('stepLimit (крок 03, шар прогону)', () => {
  it('зупиняє цикл на N-му кроці і пише рівно один рядок журналу', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'stop-')), 'stop-log.jsonl');
    let n = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => call('read_file', `c${n++}`) });
    const r = await generateText({ model, prompt: 'читай вічно', tools, stopWhen: [stepLimit(3, 't-demo', log), hasToolCall('submitArtifact')] });
    await flush();
    expect(r.steps).toHaveLength(3);
    expect(lines(log)).toEqual([expect.objectContaining({ taskId: 't-demo', layer: 'прогін', limit: 'isStepCount', value: 3, at_step: 3 })]);
  });

  it('hasToolCall зупиняє раніше — тоді stepLimit мовчить, журналу немає', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'stop-')), 'stop-log.jsonl');
    const model = new MockLanguageModelV4({ doGenerate: [call('read_file', 'c1'), call('submitArtifact', 'c2')] });
    const r = await generateText({ model, prompt: 'прочитай і здай', tools, stopWhen: [stepLimit(8, 't-demo', log), hasToolCall('submitArtifact')] });
    await flush();
    expect(r.steps).toHaveLength(2);
    expect(() => readFileSync(log, 'utf8')).toThrow();
  });
});
