/**
 * Вимір паралельності (Лаб. 2, крок 07). ХОДИТЬ У МЕРЕЖУ — запускається вручну:
 *
 *   npx tsx --env-file=.env.local scripts/parallel-eval.ts 1    «до»: послідовно
 *   npx tsx --env-file=.env.local scripts/parallel-eval.ts 4    «після»: чотири гілки
 *
 * Робота та сама, що в scripts/eval-run.ts (крок 06): для кожного запиту — вектор запиту
 * в Ollama, гібридний пошук, правило відмови, відповідь Gemini з топ-5 фрагментів.
 * Різниця лише в способі запуску: пул фіксованої ширини замість циклу з паузою.
 *
 * Паралелиться ЧИТАННЯ (запити набору). Запис однопотоковий: гілки повертають результат
 * у памʼять, у файл docs/lab2/parallel-run.json пише головний потік один раз після пулу.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { chatCompletionsModel } from '../src/agent/adapters';
import { priceUsd, ZERO_USAGE, type Usage } from '../src/cost';
import { CATALOG } from '../src/models';
import { sendTrace, type TracedCall } from '../src/otel/langfuse-ingest';
import { REFUSAL_TEXT, shouldRefuse } from '../src/rag/answer';
import { renderContext } from '../src/rag/cite';
import { ollamaEmbedder } from '../src/rag/embed';
import { bm25From, fuse, rankAll } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';

/** БЮДЖЕТ. Записано ДО запуску і дослівно перенесено в docs/lab2/budget.md, розділ 2. */
export interface Budget {
  /** Максимум гілок, що виконуються одночасно. */
  readonly maxBranches: number;
  /** Стеля токенів на весь прогін: нова гілка не стартує, коли її перетнуто. */
  readonly maxTokens: number;
  /** Стеля часу стіни на весь прогін, мс. */
  readonly maxWallMs: number;
}

/** Крок 06 витратив 35 017 токенів на 25 запитів; стеля — з запасом ~70%. */
export const BUDGET: Budget = { maxBranches: 4, maxTokens: 60_000, maxWallMs: 5 * 60_000 };
/** Ширше за 8 не запускаємо взагалі: ліміти безкоштовного рівня Gemini не опубліковані. */
export const MAX_WIDTH = 8;

export interface OllamaCounters {
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_duration?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
}

export interface BranchResult {
  readonly id: string;
  readonly refusedBeforeModel: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ms: number;
  /** Скільки з ms гілка провела в Ollama (вектор запиту) і в Gemini (відповідь). */
  readonly embedMs: number;
  readonly modelMs: number;
  readonly ollama: OllamaCounters;
  /** Скільки разів гілка повторила виклик після HTTP 429 і скільки чекала на ліміт. */
  readonly retries: number;
  readonly waitedMs: number;
}

/** Повторів після 429 на одну гілку. 429 токенів не витрачає, тож облік не змінюється. */
export const MAX_RETRIES = 4;

/**
 * Пауза перед повтором: беремо retryDelay, який радить сам Gemini у тілі 429,
 * а якщо його немає (або повідомлення обрізане) — 15 с × номер спроби.
 */
export function retryDelayMs(message: string, attempt: number): number {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return m?.[1] !== undefined ? Math.ceil(Number(m[1]) * 1000) + 500 : 15_000 * attempt;
}

/**
 * Пул фіксованої ширини, без зовнішніх залежностей (дослівно з методички).
 * Кожна гілка ловить свою помилку сама: Promise.all над сирими задачами відкинувся б
 * на першій 429, і облік гілок, які вже відпрацювали, зник би.
 */
export async function runPool<T>(
  tasks: readonly (() => Promise<T>)[],
  budget: Budget,
  spentTokens: () => number,
): Promise<{ results: (T | Error)[]; stoppedEarly: boolean }> {
  const results: (T | Error)[] = new Array(tasks.length);
  const startedAt = performance.now();
  let next = 0;
  let stoppedEarly = false;

  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      // ПРАВИЛО ЗУПИНКИ: перевіряється перед стартом нової гілки, а не всередині неї.
      if (spentTokens() >= budget.maxTokens || performance.now() - startedAt >= budget.maxWallMs) {
        stoppedEarly = true;
        return;
      }
      const i = next++;
      try {
        results[i] = await tasks[i]!();
      } catch (error) {
        results[i] = error instanceof Error ? error : new Error(String(error));
      }
    }
  };

  const width = Math.max(1, Math.min(budget.maxBranches, tasks.length));
  await Promise.all(Array.from({ length: width }, worker));
  return { results, stoppedEarly };
}

/**
 * Дослівно SYSTEM з scripts/eval-run.ts (крок 06). Не імпортується: eval-run.ts виконує прогін
 * на верхньому рівні модуля, тож імпорт запустив би ще й його. Збіг перевіряє tests/parallel.test.ts.
 */
export const SYSTEM = [
  'Ти довідник з традицій і етикету подарунків.',
  'Відповідай українською, коротко: 1–3 речення.',
  'Якщо не знаєш точної відповіді, прямо скажи, що не знаєш, і нічого не вигадуй.',
].join('\n');

const K = 5;
const OUT = 'docs/lab2/parallel-run.json';
const ns = (x: number | undefined): number | null => (x === undefined ? null : Math.round(x / 1e5) / 10); // нс → мс, 0,1

interface Entry { id: string; query: string; must_cite: string[] }

async function main(): Promise<void> {
  const width = Number(process.argv[2] ?? 1);
  if (!Number.isInteger(width) || width < 1 || width > MAX_WIDTH) {
    throw new Error(`ширина має бути цілим від 1 до ${MAX_WIDTH}, отримано ${process.argv[2]}`);
  }
  const budget: Budget = { ...BUDGET, maxBranches: width };

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY порожній: заповніть .env.local');
  const spec = CATALOG['gemini-3.5-flash-lite'];
  const model = chatCompletionsModel({
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: spec.id,
    headers: { authorization: `Bearer ${key}` },
  });
  const embedder = ollamaEmbedder();
  const index = loadIndex('data/index.json', embedder);
  const words = bm25From(index);

  // Вектор запиту — тим самим викликом, що в embed.ts, але з лічильниками Ollama з сирого тіла.
  const ollamaBase = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || 'http://localhost:11434';
  let printedRaw = false;
  const embedWithCounters = async (text: string): Promise<{ vector: number[]; counters: OllamaCounters }> => {
    const res = await fetch(`${ollamaBase}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'embeddinggemma-2:270m', input: [text], dimensions: embedder.dimensions, truncate: false }),
    });
    if (!res.ok) throw new Error(`/api/embed ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { embeddings?: number[][] } & OllamaCounters;
    const { embeddings, ...rest } = body;
    if (!printedRaw) {
      printedRaw = true;
      // Сире тіло без самого вектора (768 чисел): які лічильники повертає ВАША версія Ollama.
      console.log('сире тіло /api/embed (без embeddings):', JSON.stringify(rest));
    }
    const vector = embeddings?.[0];
    if (!vector || vector.length !== embedder.dimensions) throw new Error('/api/embed: неочікувана форма відповіді');
    const pick = (k: keyof OllamaCounters) => (typeof rest[k] === 'number' ? { [k]: rest[k] } : {});
    return {
      vector,
      counters: {
        ...pick('total_duration'), ...pick('load_duration'), ...pick('prompt_eval_count'),
        ...pick('prompt_eval_duration'), ...pick('eval_count'), ...pick('eval_duration'),
      },
    };
  };

  const entries: Entry[] = readFileSync('docs/lab2/golden/queries.jsonl', 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Entry);

  let spent = 0;
  const traced: TracedCall[] = [];
  const CONTEXT_HEADER =
    'Фрагменти документів колекції. Відповідай лише за ними; після кожного речення став id фрагмента в квадратних дужках, наприклад [korovai#0003]. Якщо відповіді у фрагментах немає — скажи, що в документах цього немає.';

  const tasks = entries.map((entry) => async (): Promise<BranchResult> => {
    const started = performance.now();
    const { vector, counters } = await embedWithCounters(entry.query);
    const embedMs = performance.now() - started;
    const ranked = rankAll(index, words, vector, entry.query);
    const served = fuse(index, ranked, K);
    const refusedBeforeModel = shouldRefuse(ranked.vector[0]?.cosine ?? 0);
    const userText = `${CONTEXT_HEADER}\n\n${renderContext(served.map((h) => h.chunk))}\n\n===\n${entry.query}`;
    let retries = 0;
    let waitedMs = 0;
    const modelStart = performance.now();
    const startIso = new Date().toISOString();
    // Підсумок токенів гілки: наш адаптер Лаб. 1 (fetch, не AI SDK) повертає turn.usage типу Usage з src/cost.ts.
    const turn = refusedBeforeModel
      ? { text: REFUSAL_TEXT, usage: ZERO_USAGE as Usage }
      : await (async () => {
          for (let attempt = 1; ; attempt++) {
            try {
              return await model(SYSTEM, [{ role: 'user', text: userText }], []);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (!message.includes('HTTP 429') || attempt > MAX_RETRIES) throw error;
              const wait = retryDelayMs(message, attempt);
              retries += 1;
              waitedMs += wait;
              await new Promise((r) => setTimeout(r, wait));
            }
          }
        })();
    const modelMs = performance.now() - modelStart;
    spent += turn.usage.inputTokens + turn.usage.outputTokens;
    if (!refusedBeforeModel) {
      traced.push({
        name: entry.id,
        model: spec.id,
        input: entry.query,
        output: turn.text.trim(),
        startTime: startIso,
        endTime: new Date().toISOString(),
        inputTokens: turn.usage.inputTokens,
        outputTokens: turn.usage.outputTokens,
        inputCostUsd: priceUsd(spec, { ...turn.usage, outputTokens: 0 }),
        outputCostUsd: priceUsd(spec, { ...turn.usage, inputTokens: 0 }),
      });
    }
    return {
      id: entry.id,
      refusedBeforeModel,
      inputTokens: turn.usage.inputTokens,
      outputTokens: turn.usage.outputTokens,
      ms: Math.round(performance.now() - started),
      embedMs: Math.round(embedMs),
      modelMs: Math.round(modelMs),
      ollama: counters,
      retries,
      waitedMs,
    };
  });

  // ЧАС СТІНИ міряється саме тут — навколо пулу. Облік токенів часу не дає.
  const wallStart = performance.now();
  const { results, stoppedEarly } = await runPool(tasks, budget, () => spent);
  const wallMs = Math.round(performance.now() - wallStart);

  const ok = results.filter((r): r is BranchResult => r !== undefined && !(r instanceof Error));
  const failed = results.filter((r): r is Error => r instanceof Error);
  const inputTokens = ok.reduce((n, r) => n + r.inputTokens, 0);
  const outputTokens = ok.reduce((n, r) => n + r.outputTokens, 0);
  const sum = (f: (r: BranchResult) => number | undefined) => ok.reduce((n, r) => n + (f(r) ?? 0), 0);

  const run = {
    runAt: new Date().toISOString(),
    budget,
    model: spec.id,
    embedder: embedder.id,
    wallMs,
    sumBranchMs: sum((r) => r.ms),
    sumEmbedMs: sum((r) => r.embedMs),
    sumModelMs: sum((r) => r.modelMs),
    retries: sum((r) => r.retries),
    sumWaitedMs: sum((r) => r.waitedMs),
    inputTokens,
    outputTokens,
    priceUsd: priceUsd(spec, { inputTokens, cachedTokens: 0, outputTokens }),
    ollamaMs: {
      sumTotalDuration: ns(sum((r) => r.ollama.total_duration)),
      sumLoadDuration: ns(sum((r) => r.ollama.load_duration)),
      sumPromptEvalDuration: ns(sum((r) => r.ollama.prompt_eval_duration)),
      sumPromptEvalCount: sum((r) => r.ollama.prompt_eval_count),
      sumEvalCount: sum((r) => r.ollama.eval_count),
    },
    done: ok.length,
    failed: failed.map((e) => e.message.slice(0, 300)),
    notStarted: entries.length - ok.length - failed.length,
    stoppedEarly,
    branches: ok,
  };

  const traceId = await sendTrace(`lab2-parallel-w${width}`, { width, wallMs, sumBranchMs: run.sumBranchMs, budget }, traced);

  // ЄДИНИЙ ЗАПИС — головний потік, після пулу. Прогони різної ширини лежать поруч під ключем w<ширина>.
  const all: Record<string, unknown> = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>) : {};
  all[`w${width}`] = { ...run, langfuseTraceId: traceId };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`, 'utf8');

  console.log({
    width,
    wallMs,
    sumBranchMs: run.sumBranchMs,
    sumEmbedMs: run.sumEmbedMs,
    sumModelMs: run.sumModelMs,
    ollamaSumTotalMs: run.ollamaMs.sumTotalDuration,
    retries: run.retries,
    sumWaitedMs: run.sumWaitedMs,
    tokens: `${inputTokens} / ${outputTokens}`,
    priceUsd: run.priceUsd.toFixed(6),
    done: ok.length,
    failed: failed.length,
    stoppedEarly,
    trace: traceId ? `lab2-parallel-w${width} (${traceId})` : 'ключів Langfuse немає',
  });
  for (const e of failed) console.error('впала гілка:', e.message.slice(0, 200));
}

// Імпорт runPool у тестах не повинен запускати прогін.
if (process.argv[1]?.endsWith('parallel-eval.ts')) await main();
