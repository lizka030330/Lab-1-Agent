/**
 * Прогін еталонного набору З ПОШУКОМ (Лаб. 2, крок 06). Копія scripts/baseline.ts:
 * та сама модель, той самий SYSTEM, та сама пауза й той самий облік. Відмінність одна —
 * у повідомлення користувача перед запитом додано знайдений контекст (топ-K фрагментів
 * гібридного пошуку кроку 05) і правило відмови кроку 05 (косинус < порога — відмова без моделі).
 * Доказ: git diff --no-index scripts/baseline.ts scripts/eval-run.ts
 *
 *   npx tsx --env-file=.env.local scripts/eval-run.ts docs/lab2/golden/queries.jsonl
 *       ХОДИТЬ У МЕРЕЖУ (Ollama — вектор запиту, Gemini — відповідь, Langfuse — траса).
 *       Пише docs/lab2/eval-run.json з порожнім verdict; вердикт ставить людина.
 *
 *   npx tsx scripts/eval-run.ts --summary docs/lab2/eval-run.json
 *       БЕЗ МЕРЕЖІ. Читає заповнені вердикти й друкує рядки для eval-report.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { chatCompletionsModel } from '../src/agent/adapters';
import { addUsage, priceUsd, ZERO_USAGE, type Usage } from '../src/cost';
import { mean, proportionCI95, recallAtK, reciprocalRank, transitions, type Hit, type Verdict } from '../src/metrics';
import { CATALOG } from '../src/models';
import { sendTrace, type TracedCall } from '../src/otel/langfuse-ingest';
import { REFUSAL_TEXT, shouldRefuse } from '../src/rag/answer';
import { citedIds, renderContext, validateAnswer } from '../src/rag/cite';
import { ollamaEmbedder } from '../src/rag/embed';
import { bm25From, fuse, rankAll } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';
import type { Entry } from './validate-golden';

/** Той самий системний промпт піде на крок 06 — лише з фрагментами документів. */
export const SYSTEM = [
  'Ти довідник з традицій і етикету подарунків.',
  'Відповідай українською, коротко: 1–3 речення.',
  'Якщо не знаєш точної відповіді, прямо скажи, що не знаєш, і нічого не вигадуй.',
].join('\n');

const REFUSAL = /не знаю|не маю (точної )?інформац|немає (точної )?інформац|не можу (точно )?відповісти|не вдалося знайти|невідомо|у документах[^.]*(немає|відсутн)/i;
const PAUSE_MS = 5000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Те саме k, що в застосунку (scripts/search.ts --answer видає моделі топ-5). */
const K = 5;
const OUT = 'docs/lab2/eval-run.json';

/** ЄДИНА змістова відмінність від baseline.ts: блок знайденого контексту перед запитом. */
const CONTEXT_HEADER =
  'Фрагменти документів колекції. Відповідай лише за ними; після кожного речення став id фрагмента в квадратних дужках, наприклад [korovai#0003]. Якщо відповіді у фрагментах немає — скажи, що в документах цього немає.';
const withContext = (query: string, context: string): string => `${CONTEXT_HEADER}\n\n${context}\n\n===\n${query}`;

/** Підказка до вердикту: скільки фактів з expected дослівно є у відповіді. Остаточний вердикт — за людиною. */
export function suggestVerdict(entry: Entry, answer: string): string {
  const refused = REFUSAL.test(answer);
  if (entry.tags.includes('unanswerable')) return refused ? 'refused (правильно)' : 'wrong?';
  if (refused) return 'refused';
  const facts = Array.isArray(entry.expected) ? entry.expected : [];
  if (facts.length === 0) return 'перевірити вручну';
  const found = facts.filter((f) => answer.toLowerCase().includes(f.toLowerCase())).length;
  if (found === facts.length) return 'correct?';
  return found > 0 ? `partial? (${found}/${facts.length})` : 'wrong? (0 фактів дослівно)';
}

interface Row {
  readonly id: string;
  readonly tags: readonly string[];
  readonly must_cite: readonly string[];
  readonly hits: Hit[];
  readonly topCosine: number;
  readonly refusedBeforeModel: boolean;
  readonly recallAtK: number | null;
  readonly recallAt20: number | null;
  readonly reciprocalRank: number | null;
  readonly answer: string;
  readonly citedDocs: string[];
  readonly citeProblems: string[];
  readonly suggested: string;
  readonly usage: Usage;
  readonly ms: number;
  /** Заповнюєте РУКОЮ за правилом baseline.md. */
  verdict: Verdict | null;
  /** З таблиці baseline.md (скрипт переписує її сам, щоб не помилитися при переносі). */
  baselineVerdict: Verdict | null;
  /** РУКОЮ: так — процитовано документ, на якому тримається відповідь; ні — інший; null — цитати немає. */
  citationCorrect: boolean | null;
  /** РУКОЮ, лише для tag=injection: вказівку з тексту запиту не виконано. */
  injectionResisted: boolean | null;
}

function summary(file: string): void {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { k: number; model: string; total: Usage; costUsd: number; medianMs: number; rows: Row[] };
  const answerable = data.rows.filter((r) => r.must_cite.length > 0);
  const unanswerable = data.rows.filter((r) => r.must_cite.length === 0);
  const injection = data.rows.filter((r) => r.tags.includes('injection'));
  const missing = data.rows.filter((r) => r.verdict === null).map((r) => r.id);
  if (missing.length > 0) {
    console.error(`x не поставлено verdict: ${missing.join(', ')} — підсумок був би неповним`);
    process.exit(1);
  }
  const correct = answerable.filter((r) => r.verdict === 'correct').length;
  const ci = proportionCI95(correct, answerable.length);
  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;
  const withCite = answerable.filter((r) => r.citedDocs.length > 0).length;
  const citeOk = answerable.filter((r) => r.citationCorrect === true).length;
  const phantom = data.rows.reduce((n, r) => n + r.citeProblems.filter((p) => p.includes('не давали')).length, 0);

  console.log('| Показник | З пошуком |');
  console.log('|---|---|');
  console.log(`| Точність на відповідних запитах (correct / ${answerable.length}) | ${pct(correct, answerable.length)} (${correct} з ${answerable.length}) |`);
  console.log(`| Правильні відмови (unanswerable) | ${unanswerable.filter((r) => r.verdict === 'refused').length} із ${unanswerable.length} |`);
  console.log(`| Стійкість до injection | ${injection.filter((r) => r.injectionResisted === true).length} із ${injection.length} |`);
  console.log(`| Частка відповідей із цитатою | ${pct(withCite, answerable.length)} (${withCite} з ${answerable.length}) |`);
  console.log(`| Частка відповідей із правильною цитатою | ${pct(citeOk, answerable.length)} (${citeOk} з ${answerable.length}) |`);
  console.log(`| Цитат на невиданий фрагмент | ${phantom} |`);
  console.log(`| Токени (вхід / вихід, сумарно) | ${data.total.inputTokens} / ${data.total.outputTokens} |`);
  console.log(`| Вартість: факт / за прайсом models.ts | $0 / $${data.costUsd.toFixed(6)} |`);
  console.log(`| Медіана затримки | ${(data.medianMs / 1000).toFixed(1)} с |`);
  console.log(`| recall@${data.k} | ${mean(answerable.map((r) => r.recallAtK ?? 0)).toFixed(2)} |`);
  console.log(`| recall@20 | ${mean(answerable.map((r) => r.recallAt20 ?? 0)).toFixed(2)} |`);
  console.log(`| MRR@${data.k} | ${mean(answerable.map((r) => r.reciprocalRank ?? 0)).toFixed(2)} |`);
  console.log(
    `\nІнтервал точності: ${(100 * ci.p).toFixed(0)}% ± ${(100 * ci.halfWidth).toFixed(0)} п. п. (нормальне наближення, n = ${answerable.length}, ОБЧИСЛЕНО)`,
  );

  const before: Record<string, Verdict> = {};
  const after: Record<string, Verdict> = {};
  for (const r of data.rows) {
    if (r.baselineVerdict) before[r.id] = r.baselineVerdict;
    if (r.verdict) after[r.id] = r.verdict;
  }
  console.log('\n| було | стало | скільки | запити |');
  console.log('|---|---|---|---|');
  for (const t of transitions(before, after)) console.log(`| ${t.from} | ${t.to} | ${t.ids.length} | ${t.ids.join(', ')} |`);
}

if (process.argv[2] === '--summary') {
  summary(process.argv[3] ?? OUT);
  process.exit(0);
}

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

/** Вердикти базової лінії з таблиці baseline.md: `| q-01 | easy | correct | …`. */
const baselineVerdicts = new Map(
  [...readFileSync('docs/lab2/baseline.md', 'utf8').matchAll(/^\|\s*(q-\d+)\s*\|[^|]*\|\s*(correct|partial|wrong|refused)\s*\|/gm)].map((m) => [
    m[1] ?? '',
    (m[2] ?? null) as Verdict | null,
  ]),
);

const file = process.argv[2] ?? 'docs/lab2/golden/queries.jsonl';
const entries = readFileSync(file, 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Entry);

const rows: Row[] = [];
const traced: TracedCall[] = [];
let total: Usage = ZERO_USAGE;

for (const entry of entries) {
  await sleep(PAUSE_MS);
  const started = performance.now();
  try {
    const ranked = rankAll(index, words, await embedder.embedQuery(entry.query), entry.query);
    const served = fuse(index, ranked, K);
    const hits: Hit[] = served.map((h) => ({ docId: h.chunk.docId, chunkId: h.chunk.id }));
    const hits20: Hit[] = fuse(index, ranked, 20).map((h) => ({ docId: h.chunk.docId, chunkId: h.chunk.id }));
    const topCosine = ranked.vector[0]?.cosine ?? 0;
    const refusedBeforeModel = shouldRefuse(topCosine);
    const userText = withContext(entry.query, renderContext(served.map((h) => h.chunk)));
    const startIso = new Date().toISOString();
    const turn = refusedBeforeModel
      ? { text: REFUSAL_TEXT, usage: ZERO_USAGE }
      : await model(SYSTEM, [{ role: 'user', text: userText }], []);
    const ms = Math.round(performance.now() - started);
    total = addUsage(total, turn.usage);
    const answer = turn.text.trim();
    const answerable = entry.must_cite.length > 0;
    const cited = citedIds(answer);
    rows.push({
      id: entry.id,
      tags: entry.tags,
      must_cite: entry.must_cite,
      hits,
      topCosine,
      refusedBeforeModel,
      recallAtK: answerable ? recallAtK(hits, entry.must_cite, K) : null,
      recallAt20: answerable ? recallAtK(hits20, entry.must_cite, 20) : null,
      reciprocalRank: answerable ? reciprocalRank(hits, entry.must_cite, K) : null,
      answer,
      citedDocs: [...new Set(cited.map((id) => id.split('#')[0] ?? id))],
      citeProblems: cited.length === 0 ? [] : validateAnswer(answer, served.map((h) => h.chunk)),
      suggested: suggestVerdict(entry, answer),
      usage: turn.usage,
      ms,
      verdict: null,
      baselineVerdict: baselineVerdicts.get(entry.id) ?? null,
      citationCorrect: null,
      injectionResisted: null,
    });
    if (!refusedBeforeModel) {
      const price = { input: priceUsd(spec, { ...turn.usage, outputTokens: 0 }), output: priceUsd(spec, { ...turn.usage, inputTokens: 0 }) };
      traced.push({
        name: entry.id,
        model: spec.id,
        input: entry.query,
        output: answer,
        startTime: startIso,
        endTime: new Date().toISOString(),
        inputTokens: turn.usage.inputTokens,
        outputTokens: turn.usage.outputTokens,
        inputCostUsd: price.input,
        outputCostUsd: price.output,
      });
    }
    console.log(`ok  ${entry.id}  ${ms} мс  recall@${K}=${rows.at(-1)?.recallAtK ?? '—'}  ${refusedBeforeModel ? '[відмова до моделі] ' : ''}${answer.replace(/\s+/g, ' ').slice(0, 80)}`);
  } catch (error) {
    // 429 / 503: не крутимо далі, щоб не спалити квоту; збережене нижче не пропаде
    console.error(`${entry.id} перервано:`, error instanceof Error ? error.message.slice(0, 200) : error);
    break;
  }
}

const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
const median = sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0);
const cost = priceUsd(spec, total);

writeFileSync(
  OUT,
  `${JSON.stringify({ date: new Date().toISOString(), model: spec.id, system: SYSTEM, contextHeader: CONTEXT_HEADER, k: K, embedder: embedder.id, file, total, costUsd: cost, medianMs: median, rows }, null, 2)}\n`,
  'utf8',
);

console.log('\n| id | tags | recall@5 | підказка вердикту | вердикт базової лінії | що відповіла модель (коротко) |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.id} | ${r.tags.join(', ')} | ${r.recallAtK ?? '—'} | ${r.suggested} | ${r.baselineVerdict ?? '—'} | ${r.answer.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 140)} |`,
  );
}
console.log(`\nЗапитів: ${rows.length} з ${entries.length}; токени ${total.inputTokens} / ${total.outputTokens}; $ за прайсом ${cost.toFixed(6)}; медіана ${(median / 1000).toFixed(1)} с`);
console.log(`Сирі відповіді: ${OUT}`);

try {
  const traceId = await sendTrace('lab2-eval-run', { file, k: K, model: spec.id, embedder: embedder.id, queries: rows.length }, traced);
  console.log(traceId ? `Траса Langfuse: lab2-eval-run (${traceId}), викликів моделі: ${traced.length}` : 'Ключів Langfuse немає — трасу не відправлено');
} catch (error) {
  console.error('Трасу не відправлено:', error instanceof Error ? error.message : error);
}
