/**
 * Шар прогону (Лаб. 3, крок 03): власний цикл агента на AI SDK з stopWhen — доказ, що ліміт спрацьовує сам.
 *
 *   npx tsx scripts/harness/stop-demo.ts [--steps 3] [--provider ollama|google]
 *
 * Задача свідомо потребує більше кроків, ніж дозволено: прочитати КОЖЕН .md у docs/lab3 (≈ 8 файлів) і лише потім
 * здати звіт через submitArtifact. stopWhen — масив: зупиняємося на першій умові, що спрацювала,
 * stepLimit(N) (src/harness/stop.ts, пише рядок у docs/lab3/stop-log.jsonl) або hasToolCall('submitArtifact').
 * Перед прогоном питаємо брейкер, після — повідомляємо йому результат (стан — .harness/breaker.json;
 * у CI він їздить між прогонами артефактом, див. .github/workflows/harness.yml).
 * Інструменти лише читають і лише в docs/lab3 — писати агентові тут нічого.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { google } from '@ai-sdk/google'; // ключ: GOOGLE_GENERATIVE_AI_API_KEY
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, hasToolCall, tool, type LanguageModel } from 'ai';
import { z } from 'zod';

import { mayRun, record } from '../../src/harness/breaker';
import { logStop, stepLimit } from '../../src/harness/stop';

const args = process.argv.slice(2);
const arg = (name: string, dflt: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? dflt) : dflt);
const N = Number(arg('--steps', '3'));
const provider = arg('--provider', 'ollama');
const TASK = 'stop-demo';
const DIR = 'docs/lab3';

function pickModel(): { model: LanguageModel; name: string } {
  if (provider === 'google') {
    const id = process.env.STOP_DEMO_MODEL || 'gemini-3.5-flash-lite';
    return { model: google(id), name: `google/${id}` };
  }
  const id = process.env.STOP_DEMO_MODEL || 'qwen3-8b-16k';
  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  return { model: createOpenAICompatible({ name: 'ollama', baseURL: `${base}/v1` })(id), name: `ollama/${id}` };
}

const tools = {
  list_docs: tool({
    description: `Перелік .md файлів у ${DIR}`,
    inputSchema: z.object({}),
    execute: async () => readdirSync(DIR).filter((f) => f.endsWith('.md')),
  }),
  read_file: tool({
    description: `Прочитати один .md файл з ${DIR} за назвою (лише читання)`,
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => readFileSync(join(DIR, basename(name)), 'utf8').slice(0, 1500),
  }),
  submitArtifact: tool({
    description: 'Здати підсумковий звіт. Викликати ЛИШЕ після того, як прочитано всі файли.',
    inputSchema: z.object({ report: z.string() }),
    execute: async () => 'звіт прийнято',
  }),
};

const gate = mayRun();
if (!gate.allow) {
  logStop({ taskId: TASK, layer: 'харнес', limit: 'circuit breaker', value: gate.why, next: 'прогін не запущено' });
  console.log(`БРЕЙКЕР: ${gate.why}. Прогін не запущено.`);
  process.exit(3);
}

const { model, name } = pickModel();
const started = Date.now();
const result = await generateText({
  model,
  system: 'Ти виконуєш задачу інструментами. Читай файли по одному. /no_think',
  prompt: `Виклич list_docs, потім прочитай КОЖЕН файл зі списку інструментом read_file (по одному виклику на файл) і лише після цього виклич submitArtifact зі звітом: таблиця «файл — одне речення про зміст».`,
  tools,
  stopWhen: [stepLimit(N, TASK), hasToolCall('submitArtifact')],
});
await new Promise((r) => setTimeout(r, 20)); // stepLimit пише журнал асинхронно

const calls = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
const submitted = calls.includes('submitArtifact');
const byLimit = !submitted && result.steps.length >= N;
const summary = {
  model: name, limit: `isStepCount(${N})`, steps: result.steps.length, tool_calls: calls,
  input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens,
  duration_s: Math.round((Date.now() - started) / 100) / 10,
  stopped_by: submitted ? "hasToolCall('submitArtifact')" : byLimit ? `isStepCount(${N})` : 'модель завершила сама',
};
console.log(JSON.stringify(summary, null, 2));

if (byLimit) {
  // задача НЕ виконана: ліміт зупинив цикл раніше, ніж агент здав звіт — це відмова, і брейкер має про неї знати
  const b = record({ ok: false, failure: 'step_limit' });
  logStop({ taskId: TASK, layer: 'харнес', limit: 'isStepCount → брейкер', value: N, model: name, tool_calls: calls.length,
    next: `задачу позначено step_limit (не здано), брейкер: ${b.state}, однакових відмов підряд: ${b.sameFails}` });
  console.error(`ЗУПИНЕНО ЛІМІТОМ: isStepCount(${N}) на кроці ${result.steps.length}; звіт не здано. Брейкер: ${b.state}.`);
  process.exit(2); // помилка краща за тишу: фабрика й CI бачать ненульовий код
}
record(submitted ? { ok: true } : { ok: false, failure: 'no_submit' });
