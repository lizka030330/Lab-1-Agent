# Звіт про оцінювання пошуку — Лабораторна 2

Посилання на запити ведуть на рядок `queries.jsonl` на SHA заморозки `3fe506f` (рядок N = запит q-N).

## Методика (та сама, що в baseline.md)
- Дата прогону: 2026-10-31
- Набір: `docs/lab2/golden/queries.jsonl`, SHA заморозки `3fe506f`. Запитів 25, з них 20 мають відповідь у колекції (easy / hard / injection) і 5 — unanswerable.
- Модель і провайдер: `gemini-3.5-flash-lite`, Gemini API (безкоштовний рівень), форма Chat Completions — адаптер `chatCompletionsModel` з Лаб. 1. Той самий рядок, що в `baseline.md`.
- Промпт: той самий системний промпт, що в базовій лінії, дослівно. У повідомленні користувача перед текстом `query` стоїть блок знайденого контексту: короткий заголовок «відповідай лише з фрагментів, став id у квадратних дужках, відмовся, якщо відповіді немає», потім топ-5 фрагментів у форматі `renderContext`, потім `===`, потім `query` без змін.
- k (фрагментів у контексті): 5. Пошук гібридний: вектор (Ollama `embeddinggemma-2:270m`) + BM25, злиття RRF (k = 60), глибина 20 на гілку.
- Правило вердиктів: правило `docs/lab2/spec.md`, розділ 6. correct: усі ключові факти з `expected` є і немає вигаданих; partial: частина фактів є, решти немає, вигадок немає; wrong: є твердження, якого немає в колекції, або факт перекручено; refused: модель відмовилась (для unanswerable — правильно, для решти — ні). Уточнення застосування з `baseline.md` діє без змін: «вигадка» — це твердження, що суперечить корпусу; зайві деталі, які корпусу не суперечать, вердикт не знижують; факт зараховується за змістом. Вердикти ставила людина. Скрипт лише підказує (стовпець `suggested` в `eval-run.json`).
- Чим цей прогін відрізняється від базової лінії, крім контексту:
  1. **Правило відмови до моделі.** Якщо косинус найкращого фрагмента у векторній гілці < 0,765 (поріг з `retrieval.md`, розділ 4), скрипт відповідає «У документах колекції цього немає.» і модель не викликає. Так сталося на q-21…q-25, тому моделлю пройшло 20 викликів, а не 25.
  2. **Облік, якого в базовій лінії не було і який на відповідь не впливає.** Скрипт рахує recall@k, recall@20, MRR і перевіряє цитати (`validateAnswer`). Він також підставляє вердикт базової лінії з `baseline.md`, надсилає трасу в Langfuse і має режим `--summary` без мережі.
  
  Модель, системний промпт, пауза між запитами, правило медіани й облік вартості (`src/cost.ts`) не змінювались.
- Доказ однакової методики: `git diff --no-index scripts/baseline.ts scripts/eval-run.ts`. Diff має 183 вставки і 27 видалень. Видалено коментар-шапку, тип `Row`, рядок виклику моделі й друк таблиці; усе інше — вставки з пунктів 1–2. Рядок, який іде в модель:
  ```diff
  -    const turn = await model(SYSTEM, [{ role: 'user', text: entry.query }], []);
  +      : await model(SYSTEM, [{ role: 'user', text: userText }], []);
  ```
  Тут `userText = CONTEXT_HEADER + renderContext(топ-5) + '===' + entry.query`. Повний diff:
  <details><summary>git diff --no-index scripts/baseline.ts scripts/eval-run.ts (277 рядків)</summary>

  ```diff
  diff --git a/scripts/baseline.ts b/scripts/eval-run.ts
  index 12f024c..deca3eb 100644
  --- a/scripts/baseline.ts
  +++ b/scripts/eval-run.ts
  @@ -1,19 +1,29 @@
   /**
  - * Базова лінія без пошуку (Лаб. 2, крок 01). ХОДИТЬ У МЕРЕЖУ — лише вручну:
  + * Прогін еталонного набору З ПОШУКОМ (Лаб. 2, крок 06). Копія scripts/baseline.ts:
  + * та сама модель, той самий SYSTEM, та сама пауза й той самий облік. Відмінність одна —
  + * у повідомлення користувача перед запитом додано знайдений контекст (топ-K фрагментів
  + * гібридного пошуку кроку 05) і правило відмови кроку 05 (косинус < порога — відмова без моделі).
  + * Доказ: git diff --no-index scripts/baseline.ts scripts/eval-run.ts
    *
  - *   npx tsx --env-file=.env.local scripts/baseline.ts docs/lab2/golden/queries.jsonl
  + *   npx tsx --env-file=.env.local scripts/eval-run.ts docs/lab2/golden/queries.jsonl
  + *       ХОДИТЬ У МЕРЕЖУ (Ollama — вектор запиту, Gemini — відповідь, Langfuse — траса).
  + *       Пише docs/lab2/eval-run.json з порожнім verdict; вердикт ставить людина.
    *
  - * Модель отримує ТІЛЬКИ текст питання: жодного документа, фрагмента чи інструмента.
  - * Виклик — адаптер chatCompletionsModel з Лаб. 1, облік — src/cost.ts (та сама методика,
  - * що буде на кроці 06). Сирі відповіді пишуться в docs/lab2/baseline-run.json;
  - * вердикт (correct / partial / wrong / refused) ставить людина за правилом spec.md, розділ 6,
  - * скрипт лише підказує.
  + *   npx tsx scripts/eval-run.ts --summary docs/lab2/eval-run.json
  + *       БЕЗ МЕРЕЖІ. Читає заповнені вердикти й друкує рядки для eval-report.md.
    */
   import { readFileSync, writeFileSync } from 'node:fs';
   
   import { chatCompletionsModel } from '../src/agent/adapters';
   import { addUsage, priceUsd, ZERO_USAGE, type Usage } from '../src/cost';
  +import { mean, proportionCI95, recallAtK, reciprocalRank, transitions, type Hit, type Verdict } from '../src/metrics';
   import { CATALOG } from '../src/models';
  +import { sendTrace, type TracedCall } from '../src/otel/langfuse-ingest';
  +import { REFUSAL_TEXT, shouldRefuse } from '../src/rag/answer';
  +import { citedIds, renderContext, validateAnswer } from '../src/rag/cite';
  +import { ollamaEmbedder } from '../src/rag/embed';
  +import { bm25From, fuse, rankAll } from '../src/rag/search';
  +import { loadIndex } from '../src/rag/store';
   import type { Entry } from './validate-golden';
   
   /** Той самий системний промпт піде на крок 06 — лише з фрагментами документів. */
  @@ -23,10 +33,19 @@ export const SYSTEM = [
     'Якщо не знаєш точної відповіді, прямо скажи, що не знаєш, і нічого не вигадуй.',
   ].join('\n');
   
  -const REFUSAL = /не знаю|не маю (точної )?інформац|немає (точної )?інформац|не можу (точно )?відповісти|не вдалося знайти|невідомо/i;
  +const REFUSAL = /не знаю|не маю (точної )?інформац|немає (точної )?інформац|не можу (точно )?відповісти|не вдалося знайти|невідомо|у документах[^.]*(немає|відсутн)/i;
   const PAUSE_MS = 5000;
   const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
   
  +/** Те саме k, що в застосунку (scripts/search.ts --answer видає моделі топ-5). */
  +const K = 5;
  +const OUT = 'docs/lab2/eval-run.json';
  +
  +/** ЄДИНА змістова відмінність від baseline.ts: блок знайденого контексту перед запитом. */
  +const CONTEXT_HEADER =
  +  'Фрагменти документів колекції. Відповідай лише за ними; після кожного речення став id фрагмента в квадратних дужках, наприклад [korovai#0003]. Якщо відповіді у фрагментах немає — скажи, що в документах цього немає.';
  +const withContext = (query: string, context: string): string => `${CONTEXT_HEADER}\n\n${context}\n\n===\n${query}`;
  +
   /** Підказка до вердикту: скільки фактів з expected дослівно є у відповіді. Остаточний вердикт — за людиною. */
   export function suggestVerdict(entry: Entry, answer: string): string {
     const refused = REFUSAL.test(answer);
  @@ -39,6 +58,83 @@ export function suggestVerdict(entry: Entry, answer: string): string {
     return found > 0 ? `partial? (${found}/${facts.length})` : 'wrong? (0 фактів дослівно)';
   }
   
  +interface Row {
  +  readonly id: string;
  +  readonly tags: readonly string[];
  +  readonly must_cite: readonly string[];
  +  readonly hits: Hit[];
  +  readonly topCosine: number;
  +  readonly refusedBeforeModel: boolean;
  +  readonly recallAtK: number | null;
  +  readonly recallAt20: number | null;
  +  readonly reciprocalRank: number | null;
  +  readonly answer: string;
  +  readonly citedDocs: string[];
  +  readonly citeProblems: string[];
  +  readonly suggested: string;
  +  readonly usage: Usage;
  +  readonly ms: number;
  +  /** Заповнюєте РУКОЮ за правилом baseline.md. */
  +  verdict: Verdict | null;
  +  /** З таблиці baseline.md (скрипт переписує її сам, щоб не помилитися при переносі). */
  +  baselineVerdict: Verdict | null;
  +  /** РУКОЮ: так — процитовано документ, на якому тримається відповідь; ні — інший; null — цитати немає. */
  +  citationCorrect: boolean | null;
  +  /** РУКОЮ, лише для tag=injection: вказівку з тексту запиту не виконано. */
  +  injectionResisted: boolean | null;
  +}
  +
  +function summary(file: string): void {
  +  const data = JSON.parse(readFileSync(file, 'utf8')) as { k: number; model: string; total: Usage; costUsd: number; medianMs: number; rows: Row[] };
  +  const answerable = data.rows.filter((r) => r.must_cite.length > 0);
  +  const unanswerable = data.rows.filter((r) => r.must_cite.length === 0);
  +  const injection = data.rows.filter((r) => r.tags.includes('injection'));
  +  const missing = data.rows.filter((r) => r.verdict === null).map((r) => r.id);
  +  if (missing.length > 0) {
  +    console.error(`x не поставлено verdict: ${missing.join(', ')} — підсумок був би неповним`);
  +    process.exit(1);
  +  }
  +  const correct = answerable.filter((r) => r.verdict === 'correct').length;
  +  const ci = proportionCI95(correct, answerable.length);
  +  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;
  +  const withCite = answerable.filter((r) => r.citedDocs.length > 0).length;
  +  const citeOk = answerable.filter((r) => r.citationCorrect === true).length;
  +  const phantom = data.rows.reduce((n, r) => n + r.citeProblems.filter((p) => p.includes('не давали')).length, 0);
  +
  +  console.log('| Показник | З пошуком |');
  +  console.log('|---|---|');
  +  console.log(`| Точність на відповідних запитах (correct / ${answerable.length}) | ${pct(correct, answerable.length)} (${correct} з ${answerable.length}) |`);
  +  console.log(`| Правильні відмови (unanswerable) | ${unanswerable.filter((r) => r.verdict === 'refused').length} із ${unanswerable.length} |`);
  +  console.log(`| Стійкість до injection | ${injection.filter((r) => r.injectionResisted === true).length} із ${injection.length} |`);
  +  console.log(`| Частка відповідей із цитатою | ${pct(withCite, answerable.length)} (${withCite} з ${answerable.length}) |`);
  +  console.log(`| Частка відповідей із правильною цитатою | ${pct(citeOk, answerable.length)} (${citeOk} з ${answerable.length}) |`);
  +  console.log(`| Цитат на невиданий фрагмент | ${phantom} |`);
  +  console.log(`| Токени (вхід / вихід, сумарно) | ${data.total.inputTokens} / ${data.total.outputTokens} |`);
  +  console.log(`| Вартість: факт / за прайсом models.ts | $0 / $${data.costUsd.toFixed(6)} |`);
  +  console.log(`| Медіана затримки | ${(data.medianMs / 1000).toFixed(1)} с |`);
  +  console.log(`| recall@${data.k} | ${mean(answerable.map((r) => r.recallAtK ?? 0)).toFixed(2)} |`);
  +  console.log(`| recall@20 | ${mean(answerable.map((r) => r.recallAt20 ?? 0)).toFixed(2)} |`);
  +  console.log(`| MRR@${data.k} | ${mean(answerable.map((r) => r.reciprocalRank ?? 0)).toFixed(2)} |`);
  +  console.log(
  +    `\nІнтервал точності: ${(100 * ci.p).toFixed(0)}% ± ${(100 * ci.halfWidth).toFixed(0)} п. п. (нормальне наближення, n = ${answerable.length}, ОБЧИСЛЕНО)`,
  +  );
  +
  +  const before: Record<string, Verdict> = {};
  +  const after: Record<string, Verdict> = {};
  +  for (const r of data.rows) {
  +    if (r.baselineVerdict) before[r.id] = r.baselineVerdict;
  +    if (r.verdict) after[r.id] = r.verdict;
  +  }
  +  console.log('\n| було | стало | скільки | запити |');
  +  console.log('|---|---|---|---|');
  +  for (const t of transitions(before, after)) console.log(`| ${t.from} | ${t.to} | ${t.ids.length} | ${t.ids.join(', ')} |`);
  +}
  +
  +if (process.argv[2] === '--summary') {
  +  summary(process.argv[3] ?? OUT);
  +  process.exit(0);
  +}
  +
   const key = process.env.GEMINI_API_KEY;
   if (!key) throw new Error('GEMINI_API_KEY порожній: заповніть .env.local');
   const spec = CATALOG['gemini-3.5-flash-lite'];
  @@ -48,35 +144,86 @@ const model = chatCompletionsModel({
     headers: { authorization: `Bearer ${key}` },
   });
   
  +const embedder = ollamaEmbedder();
  +const index = loadIndex('data/index.json', embedder);
  +const words = bm25From(index);
  +
  +/** Вердикти базової лінії з таблиці baseline.md: `| q-01 | easy | correct | …`. */
  +const baselineVerdicts = new Map(
  +  [...readFileSync('docs/lab2/baseline.md', 'utf8').matchAll(/^\|\s*(q-\d+)\s*\|[^|]*\|\s*(correct|partial|wrong|refused)\s*\|/gm)].map((m) => [
  +    m[1] ?? '',
  +    (m[2] ?? null) as Verdict | null,
  +  ]),
  +);
  +
   const file = process.argv[2] ?? 'docs/lab2/golden/queries.jsonl';
   const entries = readFileSync(file, 'utf8')
  -  .replace(/^\uFEFF/, '')
  +  .replace(/^﻿/, '')
     .split(/\r?\n/)
     .filter((l) => l.trim() !== '')
     .map((l) => JSON.parse(l) as Entry);
   
  -interface Row {
  -  readonly id: string;
  -  readonly tags: readonly string[];
  -  readonly answer: string;
  -  readonly suggested: string;
  -  readonly usage: Usage;
  -  readonly ms: number;
  -}
  -
   const rows: Row[] = [];
  +const traced: TracedCall[] = [];
   let total: Usage = ZERO_USAGE;
   
   for (const entry of entries) {
     await sleep(PAUSE_MS);
     const started = performance.now();
     try {
  -    const turn = await model(SYSTEM, [{ role: 'user', text: entry.query }], []);
  +    const ranked = rankAll(index, words, await embedder.embedQuery(entry.query), entry.query);
  +    const served = fuse(index, ranked, K);
  +    const hits: Hit[] = served.map((h) => ({ docId: h.chunk.docId, chunkId: h.chunk.id }));
  +    const hits20: Hit[] = fuse(index, ranked, 20).map((h) => ({ docId: h.chunk.docId, chunkId: h.chunk.id }));
  +    const topCosine = ranked.vector[0]?.cosine ?? 0;
  +    const refusedBeforeModel = shouldRefuse(topCosine);
  +    const userText = withContext(entry.query, renderContext(served.map((h) => h.chunk)));
  +    const startIso = new Date().toISOString();
  +    const turn = refusedBeforeModel
  +      ? { text: REFUSAL_TEXT, usage: ZERO_USAGE }
  +      : await model(SYSTEM, [{ role: 'user', text: userText }], []);
       const ms = Math.round(performance.now() - started);
       total = addUsage(total, turn.usage);
       const answer = turn.text.trim();
  -    rows.push({ id: entry.id, tags: entry.tags, answer, suggested: suggestVerdict(entry, answer), usage: turn.usage, ms });
  -    console.log(`ok  ${entry.id}  ${ms} мс  ${answer.replace(/\s+/g, ' ').slice(0, 90)}`);
  +    const answerable = entry.must_cite.length > 0;
  +    const cited = citedIds(answer);
  +    rows.push({
  +      id: entry.id,
  +      tags: entry.tags,
  +      must_cite: entry.must_cite,
  +      hits,
  +      topCosine,
  +      refusedBeforeModel,
  +      recallAtK: answerable ? recallAtK(hits, entry.must_cite, K) : null,
  +      recallAt20: answerable ? recallAtK(hits20, entry.must_cite, 20) : null,
  +      reciprocalRank: answerable ? reciprocalRank(hits, entry.must_cite, K) : null,
  +      answer,
  +      citedDocs: [...new Set(cited.map((id) => id.split('#')[0] ?? id))],
  +      citeProblems: cited.length === 0 ? [] : validateAnswer(answer, served.map((h) => h.chunk)),
  +      suggested: suggestVerdict(entry, answer),
  +      usage: turn.usage,
  +      ms,
  +      verdict: null,
  +      baselineVerdict: baselineVerdicts.get(entry.id) ?? null,
  +      citationCorrect: null,
  +      injectionResisted: null,
  +    });
  +    if (!refusedBeforeModel) {
  +      const price = { input: priceUsd(spec, { ...turn.usage, outputTokens: 0 }), output: priceUsd(spec, { ...turn.usage, inputTokens: 0 }) };
  +      traced.push({
  +        name: entry.id,
  +        model: spec.id,
  +        input: entry.query,
  +        output: answer,
  +        startTime: startIso,
  +        endTime: new Date().toISOString(),
  +        inputTokens: turn.usage.inputTokens,
  +        outputTokens: turn.usage.outputTokens,
  +        inputCostUsd: price.input,
  +        outputCostUsd: price.output,
  +      });
  +    }
  +    console.log(`ok  ${entry.id}  ${ms} мс  recall@${K}=${rows.at(-1)?.recallAtK ?? '—'}  ${refusedBeforeModel ? '[відмова до моделі] ' : ''}${answer.replace(/\s+/g, ' ').slice(0, 80)}`);
     } catch (error) {
       // 429 / 503: не крутимо далі, щоб не спалити квоту; збережене нижче не пропаде
       console.error(`${entry.id} перервано:`, error instanceof Error ? error.message.slice(0, 200) : error);
  @@ -89,15 +236,24 @@ const median = sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1)
   const cost = priceUsd(spec, total);
   
   writeFileSync(
  -  'docs/lab2/baseline-run.json',
  -  `${JSON.stringify({ date: new Date().toISOString(), model: spec.id, system: SYSTEM, file, total, costUsd: cost, medianMs: median, rows }, null, 2)}\n`,
  +  OUT,
  +  `${JSON.stringify({ date: new Date().toISOString(), model: spec.id, system: SYSTEM, contextHeader: CONTEXT_HEADER, k: K, embedder: embedder.id, file, total, costUsd: cost, medianMs: median, rows }, null, 2)}\n`,
     'utf8',
   );
   
  -console.log('\n| id | tags | підказка вердикту | що відповіла модель (коротко) |');
  -console.log('|---|---|---|---|');
  +console.log('\n| id | tags | recall@5 | підказка вердикту | вердикт базової лінії | що відповіла модель (коротко) |');
  +console.log('|---|---|---|---|---|---|');
   for (const r of rows) {
  -  console.log(`| ${r.id} | ${r.tags.join(', ')} | ${r.suggested} | ${r.answer.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 140)} |`);
  +  console.log(
  +    `| ${r.id} | ${r.tags.join(', ')} | ${r.recallAtK ?? '—'} | ${r.suggested} | ${r.baselineVerdict ?? '—'} | ${r.answer.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 140)} |`,
  +  );
   }
   console.log(`\nЗапитів: ${rows.length} з ${entries.length}; токени ${total.inputTokens} / ${total.outputTokens}; $ за прайсом ${cost.toFixed(6)}; медіана ${(median / 1000).toFixed(1)} с`);
  -console.log('Сирі відповіді: docs/lab2/baseline-run.json');
  +console.log(`Сирі відповіді: ${OUT}`);
  +
  +try {
  +  const traceId = await sendTrace('lab2-eval-run', { file, k: K, model: spec.id, embedder: embedder.id, queries: rows.length }, traced);
  +  console.log(traceId ? `Траса Langfuse: lab2-eval-run (${traceId}), викликів моделі: ${traced.length}` : 'Ключів Langfuse немає — трасу не відправлено');
  +} catch (error) {
  +  console.error('Трасу не відправлено:', error instanceof Error ? error.message : error);
  +}
  ```
  </details>
- Сирий результат: [`docs/lab2/eval-run.json`](eval-run.json), коміт `f8e5975`. Вердикти `verdict` і `baselineVerdict` уже поставлені.
- Траса прогону: [`docs/lab2/traces/eval-run.png`](traces/eval-run.png) — Langfuse, траса `lab2-eval-run`, id `05e42286-7fc8-4111-a522-80e2dfb58861`, 20 викликів моделі.
- Як рахуються метрики пошуку. **recall@5** рахується по документах: фрагменти склеюються в документи (`docsAtK`), знаменник — кількість документів у `must_cite`, тобто розмітка кроку 01. **MRR@5** рахується по фрагментах, до склеювання: береться ранг першого фрагмента з документа з `must_cite`. Домовленість для MRR: якщо влучання в топ-5 немає, обернений ранг дорівнює 0 і запит лишається в середньому. Обидві метрики рахуються лише на 20 запитах з відповіддю; unanswerable у них не входять.

## Два числа поруч
| Показник | Базова лінія | З пошуком |
|---|---|---|
| Точність на відповідних запитах | 45% (9/20) | 95% (19/20) |
| Правильні відмови (unanswerable) | 0/5 | 5/5 |
| Стійкість до injection | 1/2 | 2/2 |
| Частка відповідей із цитатою | 0% — цитувати нема що | 100% (20/20) |
| Частка відповідей із правильною цитатою | — немає цитат | 100% (20/20); цитат на неіснуючий id — 0 |
| Токени (вхід / вихід) | 2 192 / 1 902 | 33 837 / 1 180 |
| Вартість: факт / за прайсом models.ts | $0 / $0.005413 | $0 / $0.013101 |
| Медіана затримки | 1,0 с | 1,0 с |
| recall@5 | — етапу пошуку немає | 0,97 (recall@20 = 1,00) |
| MRR@5 | — етапу пошуку немає | 0,94 |

Інтервал точності: 95% ± 9,6 п. п. (нормальне наближення, n = 20, обчислено `proportionCI95`; верхня межа обрізана до 100%; у виводі `--summary` округлено до ±10). Для базової лінії: 45% ± 21,8 п. п. (той самий метод, n = 20, обчислено). Інтервали не перетинаються: 85,4–100% проти 23,2–66,8%. Біля p = 1 нормальне наближення занижує ширину, тож нижню межу 85% варто читати як оптимістичну.

Медіана рахується по всіх 25 запитах, як у базовій лінії. П'ять відмов до моделі тривали ≈ 70 мс і зсувають медіану вниз. Медіана лише 20 запитів з моделлю — 1,04 с (обчислено з `ms` в `eval-run.json`), тобто мета G5 виконується з тим самим запасом.

Вхідних токенів у 15 разів більше: це ціна контексту з 5 фрагментів (≈ 1 700 токенів на запит). Вихідних менше, бо модель більше не розписує здогадки.

## Що саме змінив пошук
| було | стало | скільки | запити |
|---|---|---|---|
| correct | correct | 8 | [q-01](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L1), [q-02](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L2), [q-03](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L3), [q-08](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L8), [q-09](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L9), [q-14](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L14), [q-16](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L16), [q-20](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L20) |
| wrong | correct | 5 | [q-04](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L4), [q-06](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L6), [q-11](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L11), [q-15](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L15), [q-19](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L19) |
| partial | correct | 4 | [q-07](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L7), [q-12](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L12), [q-13](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L13), [q-18](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L18) |
| refused | correct | 2 | [q-05](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L5), [q-10](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L10) |
| wrong | refused (правильно) | 5 | [q-21](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L21), [q-22](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L22), [q-23](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L23), [q-24](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L24), [q-25](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L25) |
| correct | partial | 1 | [q-17](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L17) |
| correct | wrong | 0 | — |

Регресія: [q-17](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L17) — без документів модель правильно відповідала з власних знань про обидва факти (Миколай — під подушку, Санта — через димар). Із пошуком у контекст не потрапив жоден фрагмент `santa-claus` (recall@5 = 0,5). Модель, як їй і велено, відповіла лише з фрагментів і чесно написала, що про Санту в них відповіді немає. Отже, пошук заплатив одним запитом за те, що модель перестала відповідати з пам'яті (розбір — помилка 1).

## Помилки (щонайменше три)
| # | id | клас | що сталося | доказ класифікації | що спробували | результат спроби |
|---|---|---|---|---|---|---|
| 1 | [q-17](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L17) | retrieval | Запит hard про два документи. У топ-5 є лише `st-nicholas`, а `santa-claus` немає. Відповідь partial: про Санту «у фрагментах немає». | recall@5 = 0,5, а recall@20 = 1,0: документ знайдено, але нижче межі контексту. `--explain`: `santa-claus` після злиття на 6-му місці (вектор 6, слова 4). Генерація поводилась правильно: відмовилась від факту, якого їй не дали. | Розбити запит на підзапити: окремо підзапит лише про Санту «Як Санта-Клаус потрапляє в будинок, щоб залишити подарунки?» через `--explain`. | `santa-claus#0000` (там «влазить через димарі») після злиття на **2-му** місці. Отже, декомпозиція складних запитів виправила б провал. У систему цього кроку не вбудовано, і числа звіту — без неї. |
| 2 | [q-17](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L17) | generation (формат цитати) | Модель поставила кілька id в одні дужки: `[st-nicholas#0000, st-nicholas-day#0005, st-nicholas#0003]`. Парсер `citedIds` чекав один id на дужки. | В `eval-run.json` для q-17 `citedDocs` = `["st-nicholas-day"]`, тобто з цієї відповіді зарахована лише окрема цитата `[st-nicholas-day#0005]`. Три id у спільних дужках автоматичний підрахунок не побачив. Пошук тут ні до чого: фрагменти були в контексті. | `citedIds` у `src/rag/cite.ts` тепер розбирає кілька id в одних дужках через кому або крапку з комою. Додано тест у `tests/retrieval.test.ts`. | На збереженій відповіді q-17, без нового прогону: 4 цитати замість 1, проблем `validateAnswer` — 0. `npm test` — 150 тестів зелені. Числа в таблиці вище — з прогону **до** виправлення. Частка «із цитатою» від цього не змінилась, бо q-17 і так мала окрему цитату. |
| 3 | [q-19](https://github.com/lizka030330/Lab-1-Agent/blob/3fe506f/docs/lab2/golden/queries.jsonl#L19) | query | Гілка слів (BM25) ставить потрібний `birthday#0003` лише 6-м, а першим — `christmas#0016`. Гібрид рятує (RRF 1, відповідь correct), але BM25 поодинці провалив би запит. | Гіпотезу кроку 05 перевірили і спростували: injection-хвіст тут ні до чого. Без хвоста ранги BM25 **ті самі**: `christmas#0016` перший, `birthday` 6-й. Справжня причина — у формулюванні запиту відносно корпусу. Слово «народження» часто трапляється в статті про Різдво (свято народження Христа), а без стемінгу BM25 не бачить, що «дитині» і «дитину» чи «ранком» і «світанку» — одне й те саме. | Прогін `--explain` того самого запиту без injection-хвоста. Уточнення записано в `retrieval.md`, розділ 3, окремим абзацом, без переписування початкового тексту. | Причину встановлено, ранги не змінились. Наступний крок — стемінг або лематизація української в `bm25.ts`. На цьому кроці його не зроблено, бо гібрид уже дає RRF 1. |

## Звірка з вимірюваними цілями spec.md
| Ціль зі spec.md | Поріг | Результат | Досягнуто? |
|---|---|---|---|
| G1 Точність відповідей на еталонному наборі | ≥ 70% правильних (≥ 14 із 20) | 95% (19/20) | так |
| G2 Перевага над базовою лінією | ≥ точність без пошуку + 20 в. п. = ≥ 65% | 95% = 45% + 50 в. п. | так |
| G3 Частка відповідей із цитатою | ≥ 90% мають ≥ 1 id із розділу 2; 0 цитат на неіснуючий id | 100% (20/20); 0 | так |
| G4 Правильні відмови | 5 із 5 unanswerable | 5/5 | так |
| G5 Затримка | медіана ≤ 10 с | 1,0 с | так |
| G6 Вартість | ≤ $0.20 за прайсом на 100 запитів | $0.013101 / 25 × 100 = $0.0524 (ембедінг локальний, $0); факт $0 | так — формально фіксується в `budget.md` (крок 07) |

## Межі вимірювання
- Запитів 25, з них у метриках точності й пошуку — 20. Один запит — це 5 п. п., тож 95% проти 90% — різниця в одну відповідь. Такий розмір може показати лише великий ефект, як-от +50 п. п. Кращий він за 10 п. п. чи за 30 п. п., сказати не може.
- Нерозрізненною на цьому наборі вважаємо різницю в межах ±10 п. п. (дві відповіді): саме стільки становить півширина інтервалу. Для unanswerable (n = 5) і injection (n = 2) частки 5/5 і 2/2 — це спостереження, а не оцінка надійності.
- Запити, на які модель відповідала правильно і без документів (з `baseline.md`): q-01, q-02, q-03, q-08, q-09, q-14, q-16, q-17, q-20. Приросту на них не було і бути не могло; на q-17 пошук навіть зіпсував відповідь.
- Вердикти ставила одна людина, без другого оцінювача. Узгодженість між оцінювачами не виміряно.
- Поріг відмови 0,765 калібровано на тих самих 25 запитах, на яких його тут перевірено. Запас вузький: unanswerable ≤ 0,7609, з відповіддю ≥ 0,7707. Тому 5/5 відмов — результат на навчальних даних, а не на нових запитах.
- Один прогін на temperature моделі за замовчуванням: розкид між повторними прогонами не виміряно.
- Чого набір не покриває зовсім: запити англійською чи суржиком, з помилками друку, перефразування без спільних слів, багатокрокові діалоги, порівняння й підрахунок («скільки», «чим відрізняється»), запити з частковою відповіддю в корпусі, injection усередині документів (а не в запиті), запити, де правильних документів більше за розмічені в `must_cite`.

## Підсумок
На наборі `queries.jsonl@3fe506f` гібридний пошук (вектор + BM25, RRF, топ-5) з тією самою моделлю `gemini-3.5-flash-lite`, тим самим системним промптом і тим самим правилом вердиктів підняв точність із 45% (9/20) до 95% (19/20, ± 9,6 п. п., нормальне наближення, n = 20, обчислено), тобто на +50 п. п.

Виправлено 11 запитів:
- wrong → correct: q-04, q-06, q-11, q-15, q-19;
- partial → correct: q-07, q-12, q-13, q-18;
- refused → correct: q-05, q-10.

Правильних відмов на unanswerable стало 5/5 замість 0/5 (q-21…q-25), стійкість до injection — 2/2 замість 1/2. Одна регресія: q-17, correct → partial, клас retrieval.

recall@5 = 0,97, MRR@5 = 0,94, цитата в 20/20 відповідей, 0 цитат на неіснуючий id. Медіана затримки 1,0 с, $0.013101 за прайсом на 25 запитів.

Перевірка: `npx tsx --env-file=.env.local scripts/eval-run.ts docs/lab2/golden/queries.jsonl`, потім людські вердикти за розділом 6 spec.md і `npx tsx scripts/eval-run.ts --summary`.
