import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { chatCompletionsModel, messagesModel, type Fetch } from '../src/agent/adapters';
import { runAgentLoop, type Message, type Model, type ModelTurn } from '../src/agent/agent-loop';
import { createTools, resolveInside, type LogEntry } from '../src/agent/tools';

// Мережа в тестах заборонена: справжній fetch одразу падає.
beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('мережа в тестах заборонена')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Тимчасовий «репозиторій» для інструментів.
const root = mkdtempSync(path.join(tmpdir(), 'lab1-loop-'));
mkdirSync(path.join(root, 'src'));
writeFileSync(path.join(root, 'src', 'health.ts'), 'export const HealthResponse = {};\n');
writeFileSync(path.join(root, '.env.local'), 'GEMINI_API_KEY=не-читати\n');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const tools = createTools(root);
const Answer = z.object({ summary: z.string(), files: z.array(z.string()) }).strict();

const usage = (input: number, output: number) => ({ inputTokens: input, cachedTokens: 0, outputTokens: output });
const callTool = (name: string, input: unknown, tokens = usage(10, 5)): ModelTurn => ({
  text: '',
  calls: [{ id: `c-${name}`, name, input }],
  usage: tokens,
});
const answer = (text: string, tokens = usage(10, 5)): ModelTurn => ({ text, calls: [], usage: tokens });

/** Підроблена модель: віддає ходи по черзі (останній повторює) і запам'ятовує, що бачила. */
function fakeModel(...turns: ModelTurn[]): { model: Model; seen: Message[][] } {
  const seen: Message[][] = [];
  const model: Model = async (_system, messages) => {
    seen.push([...messages]);
    return turns[Math.min(seen.length, turns.length) - 1] ?? answer('');
  };
  return { model, seen };
}

function run(model: Model, maxSteps: number, tokenBudget: number) {
  const log: LogEntry[] = [];
  const result = runAgentLoop({
    model,
    tools,
    system: 'тест',
    task: 'задача',
    output: Answer,
    maxSteps,
    tokenBudget,
    session: 's1',
    log: (entry) => log.push(entry),
  });
  return { result, log };
}

describe('runAgentLoop — зупинки', () => {
  it('зупиняється на ліміті кроків (бюджет навмисно недосяжний)', async () => {
    const { model, seen } = fakeModel(callTool('list_files', { path: '.' }));
    const { result, log } = run(model, 3, 1_000_000);
    const r = await result;
    expect(r.stop).toBe('max-steps');
    expect(r.steps).toBe(3);
    expect(seen).toHaveLength(3);
    expect(log).toHaveLength(3);
    expect(r.usage.inputTokens + r.usage.outputTokens).toBe(45);
  });

  it('зупиняється на бюджеті токенів (ліміт кроків навмисно недосяжний)', async () => {
    const { model, seen } = fakeModel(callTool('list_files', { path: '.' }, usage(400, 100)));
    const r = await run(model, 1_000, 1_200).result;
    expect(r.stop).toBe('token-budget');
    // 500 → 1000 → 1500: перед четвертим викликом бюджет уже вичерпано
    expect(seen).toHaveLength(3);
    expect(r.steps).toBe(3);
    expect(r.usage.inputTokens + r.usage.outputTokens).toBe(1_500);
  });
});

describe('runAgentLoop — структурований вихід', () => {
  it('приймає JSON у ```json-обгортці, якщо він проходить схему', async () => {
    const { model } = fakeModel(answer('```json\n{"summary":"ok","files":["app/api/health/route.ts"]}\n```'));
    const r = await run(model, 5, 10_000).result;
    expect(r).toMatchObject({ stop: 'done', steps: 1, output: { summary: 'ok', files: ['app/api/health/route.ts'] } });
  });

  it('невалідний вихід не повертається: помилку схеми віддано моделі, другий вихід прийнято', async () => {
    const { model, seen } = fakeModel(answer('{"summary": 42}'), answer('{"summary":"ok","files":[]}'));
    const r = await run(model, 5, 10_000).result;
    expect(r.stop).toBe('done');
    expect(r.steps).toBe(2);
    const feedback = seen[1]?.at(-1);
    expect(feedback?.role).toBe('user');
    expect(feedback?.role === 'user' ? feedback.text : '').toContain('не пройшла схему');
  });

  it.each([
    ['не JSON', 'готово!'],
    ['зайве поле', '{"summary":"ok","files":[],"extra":1}'],
    ['не той тип', '{"summary":"ok","files":"route.ts"}'],
  ])('вихід «%s» ніколи не стає результатом', async (_name, text) => {
    const { model } = fakeModel(answer(text));
    const r = await run(model, 4, 10_000).result;
    expect(r.stop).toBe('max-steps');
    expect('output' in r).toBe(false);
  });
});

describe('інструменти', () => {
  it('невалідні аргументи ловить zod: помилка йде моделі, у журналі result=error', async () => {
    const { model, seen } = fakeModel(callTool('read_file', { path: 42 }), answer('{"summary":"ok","files":[]}'));
    const { result, log } = run(model, 5, 10_000);
    expect((await result).stop).toBe('done');
    expect(log[0]).toMatchObject({ tool: 'read_file', result: 'error' });
    const toolMessage = seen[1]?.at(-1);
    expect(toolMessage?.role === 'tool' ? toolMessage.results[0]?.content : '').toContain('Невалідні аргументи');
  });

  it('схема строга: зайве поле — помилка, правильний виклик читає файл', async () => {
    const readFileTool = tools.find((t) => t.name === 'read_file');
    expect(readFileTool?.jsonSchema).toMatchObject({ additionalProperties: false, required: ['path'] });
    expect(readFileTool?.jsonSchema).not.toHaveProperty('$schema');
    expect(await readFileTool?.run({ path: 'src/health.ts', mode: 'rw' })).toMatchObject({ outcome: 'error' });
    expect(await readFileTool?.run({ path: 'src/health.ts' })).toMatchObject({
      outcome: 'ok',
      content: expect.stringContaining('HealthResponse'),
    });
  });

  it('шлях поза репозиторієм і .env* — відмова; рядок журналу має всі 6 полів', async () => {
    const { model } = fakeModel(
      {
        text: '',
        calls: [
          { id: 'a', name: 'read_file', input: { path: '../outside.txt' } },
          { id: 'b', name: 'read_file', input: { path: '.env.local' } },
        ],
        usage: usage(10, 5),
      },
      answer('{"summary":"ok","files":[]}'),
    );
    const { result, log } = run(model, 5, 10_000);
    await result;
    expect(log.map((e) => e.result)).toEqual(['denied', 'denied']);
    expect(Object.keys(log[1] ?? {}).sort()).toEqual(['input', 'result', 'session', 'source', 'tool', 'ts']);
    expect(log[1]).toMatchObject({ tool: 'read_file', input: { path: '.env.local' }, session: 's1', source: 'agent-loop' });
    expect(() => resolveInside(root, '.env.example')).not.toThrow();
  });

  it('невідомий інструмент — помилка в журналі, а не падіння циклу', async () => {
    const { model } = fakeModel(callTool('write_file', { path: 'x' }), answer('{"summary":"ok","files":[]}'));
    const { result, log } = run(model, 5, 10_000);
    expect((await result).stop).toBe('done');
    expect(log[0]).toMatchObject({ tool: 'write_file', result: 'error' });
  });
});

/** Підроблений транспорт: віддає задану відповідь і запам'ятовує запит. */
function fakeFetch(responseBody: unknown) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const send: Fetch = async (url, init) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { send, requests };
}

describe('адаптери форм API (без мережі)', () => {
  const readCall = { id: 'toolu_1', name: 'read_file', input: { path: 'src/health.ts' } };
  const history: Message[] = [
    { role: 'user', text: 'задача' },
    { role: 'assistant', text: '', calls: [readCall] },
    { role: 'tool', results: [{ call: readCall, outcome: 'denied', content: 'ні' }] },
  ];

  it('Messages-форма: max_tokens, input_schema, tool_result з is_error; вхід = input_tokens + cache_read', async () => {
    const { send, requests } = fakeFetch({
      content: [
        { type: 'text', text: 'дивлюсь' },
        { type: 'tool_use', id: 'toolu_2', name: 'list_files', input: { path: 'app' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, cache_read_input_tokens: 980, output_tokens: 7 },
    });
    const model = messagesModel({ url: 'http://localhost:11434/v1/messages', model: 'qwen3:4b', fetch: send });
    const turn = await model('система', history, tools);
    const body = requests[0]?.body;
    expect(requests[0]?.url).toBe('http://localhost:11434/v1/messages');
    expect(body).toMatchObject({ model: 'qwen3:4b', max_tokens: 2048, system: 'система' });
    expect(body?.tools).toContainEqual(
      expect.objectContaining({ name: 'read_file', input_schema: expect.objectContaining({ additionalProperties: false }) }),
    );
    expect(body?.messages).toEqual([
      { role: 'user', content: 'задача' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/health.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ні', is_error: true }] },
    ]);
    expect(turn.calls).toEqual([{ id: 'toolu_2', name: 'list_files', input: { path: 'app' } }]);
    expect(turn.text).toBe('дивлюсь');
    expect(turn.usage).toEqual({ inputTokens: 1_000, cachedTokens: 980, outputTokens: 7 });
  });

  it('Chat Completions-форма: system першим, arguments — рядок, результат у role "tool"', async () => {
    const { send, requests } = fakeFetch({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'read_file', arguments: '{"path":"AGENTS.md"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1_000, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 900 } },
    });
    const model = chatCompletionsModel({
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-3.8-flash',
      headers: { authorization: 'Bearer test-key' },
      fetch: send,
    });
    const turn = await model('система', history, tools);
    const request = requests[0];
    expect(request?.headers).toMatchObject({ authorization: 'Bearer test-key' });
    expect(request?.body.messages).toEqual([
      { role: 'system', content: 'система' },
      { role: 'user', content: 'задача' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/health.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'ПОМИЛКА (denied): ні' },
    ]);
    expect(request?.body.tools).toContainEqual(
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'list_files' }) }),
    );
    expect(turn.calls[0]).toMatchObject({ id: 'call_9', name: 'read_file', input: { path: 'AGENTS.md' } });
    expect(turn.usage).toEqual({ inputTokens: 1_000, cachedTokens: 900, outputTokens: 12 });
  });

  it('помилка HTTP (наприклад, 429 — вичерпана квота) не ковтається', async () => {
    const send: Fetch = async () => new Response('RESOURCE_EXHAUSTED', { status: 429 });
    const model = chatCompletionsModel({ url: 'https://example.test/v1/chat/completions', model: 'm', fetch: send });
    await expect(model('s', history, tools)).rejects.toThrow('HTTP 429');
  });
});