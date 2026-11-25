import { describe, expect, it } from 'vitest';

import { assertJudgeUp } from '../../src/multi/preflight';

const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('preflight верифікатора (крок 04)', () => {
  it('Ollama не відповідає — помилка ДО Gemini', async () => {
    const f = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(assertJudgeUp('http://localhost:11434', 'qwen3-8b-16k', f)).rejects.toThrow(/Gemini ще не викликано/);
  });
  it('моделі немає — помилка; є — тихо', async () => {
    await expect(assertJudgeUp('u', 'qwen3-8b-16k', (async () => resp({ models: [{ name: 'llama3' }] })) as unknown as typeof fetch)).rejects.toThrow(/немає моделі/);
    await expect(assertJudgeUp('u', 'qwen3-8b-16k', (async () => resp({ models: [{ name: 'qwen3-8b-16k:latest' }] })) as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});
