/**
 * Гібридний пошук із командного рядка (крок 05). Вектор запиту — локальна Ollama,
 * той самий ембедер, що й індекс.
 *
 *   npx tsx scripts/search.ts "<запит>"                пошук: топ-5 з цитатами
 *   npx tsx scripts/search.ts "<запит>" --explain      три списки: вектор, слова, RRF
 *   npx tsx scripts/search.ts --golden                 ранги must_cite для всіх запитів набору + косинус найкращого
 *   npx tsx --env-file=.env.local scripts/search.ts "<запит>" --answer   відповідь моделі з цитатами (Gemini)
 */
import { readFileSync, writeFileSync } from 'node:fs';

import type { Entry } from './validate-golden';
import { chatCompletionsModel } from '../src/agent/adapters';
import { ANSWER_SYSTEM, buildUserMessage, isRefusal, REFUSAL_TEXT, REFUSE_BELOW_COSINE, shouldRefuse } from '../src/rag/answer';
import { citedIds, renderCitation, renderContext, validateAnswer } from '../src/rag/cite';
import { ollamaEmbedder } from '../src/rag/embed';
import { DEPTH, bm25From, fuse, rankAll, type Rankings } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';

const embedder = ollamaEmbedder();
const index = loadIndex('data/index.json', embedder);
const words = bm25From(index);
const docOf = new Map(index.chunks.map((c) => [c.id, c.docId]));

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const query = args.find((a) => !a.startsWith('--')) ?? '';

/** Ранг (з 1) найкращого фрагмента документа docId у списку; null — немає. */
function docRank(list: readonly { id: string }[], docId: string): number | null {
  const i = list.findIndex((x) => docOf.get(x.id) === docId);
  return i < 0 ? null : i + 1;
}

async function rankings(q: string): Promise<Rankings> {
  return rankAll(index, words, await embedder.embedQuery(q), q);
}

function explain(r: Rankings): void {
  const fused = fuse(index, r, 10);
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(`${pad('вектор (cosine)', 34)}${pad('слова (BM25)', 34)}RRF (k=60)`);
  for (let i = 0; i < 10; i++) {
    const v = r.vector[i];
    const w = r.words[i];
    const f = fused[i];
    console.log(
      pad(v ? `${String(i + 1).padStart(2)}  ${v.id}  ${v.cosine.toFixed(4)}` : '', 34) +
        pad(w ? `${String(i + 1).padStart(2)}  ${w.id}  ${w.score.toFixed(2)}` : i === 0 ? ' порожньо: жодного слова запиту' : '', 34) +
        (f ? `${String(i + 1).padStart(2)}  ${f.chunk.id}  ${f.rrf.toFixed(5)}` : ''),
    );
  }
  console.log(`(у гілці слів знайдено фрагментів: ${r.words.length}; глибина злиття — ${DEPTH} з кожної гілки)`);
}

async function golden(): Promise<void> {
  const entries = readFileSync('docs/lab2/golden/queries.jsonl', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Entry);
  const rows = [];
  console.log('| id | tags | must_cite → ранг: вектор / слова / RRF | топ-косинус | фрагментів у словах |');
  console.log('|---|---|---|---|---|');
  for (const e of entries) {
    const r = await rankings(e.query);
    const fused = fuse(index, r, DEPTH * 2).map((h) => ({ id: h.chunk.id }));
    const ranks = e.must_cite.map((d) => ({
      doc: d,
      vector: docRank(r.vector, d),
      words: docRank(r.words, d),
      rrf: docRank(fused, d),
    }));
    const top = r.vector[0]?.cosine ?? 0;
    rows.push({ id: e.id, tags: e.tags, ranks, topCosine: top, wordHits: r.words.length });
    const show = (x: number | null) => (x === null ? '—' : String(x));
    console.log(
      `| ${e.id} | ${e.tags.join(', ')} | ${ranks.map((k) => `${k.doc}: ${show(k.vector)} / ${show(k.words)} / ${show(k.rrf)}`).join('; ') || '—'} | ${top.toFixed(4)} | ${r.words.length} |`,
    );
  }
  writeFileSync('docs/lab2/search-golden.json', `${JSON.stringify({ date: new Date().toISOString(), embedder: embedder.id, rows }, null, 2)}\n`);
  console.log('\nСирі числа: docs/lab2/search-golden.json');
}

async function answer(q: string): Promise<void> {
  const r = await rankings(q);
  const hits = fuse(index, r, 5);
  const best = r.vector[0];
  console.log(`Видані фрагменти: ${hits.map((h) => `${h.chunk.id} (cos ${h.cosine.toFixed(3)})`).join(', ')}`);
  console.log(`Найкращий фрагмент векторної гілки: ${best?.id ?? '—'} (cos ${(best?.cosine ?? 0).toFixed(4)}), поріг відмови ${REFUSE_BELOW_COSINE}`);
  if (shouldRefuse(best?.cosine)) {
    console.log(`\nВідмова без виклику моделі: косинус найкращого фрагмента < ${REFUSE_BELOW_COSINE}.\n${REFUSAL_TEXT}`);
    return;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY порожній: запускайте з --env-file=.env.local');
  const model = chatCompletionsModel({
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-3.5-flash-lite',
    headers: { authorization: `Bearer ${key}` },
  });
  const turn = await model(ANSWER_SYSTEM, [{ role: 'user', text: buildUserMessage(q, renderContext(hits.map((h) => h.chunk))) }], []);
  const text = turn.text.trim();
  console.log(`\nВідповідь:\n${text}`);
  if (isRefusal(text)) {
    console.log('\n(модель відмовилась — для unanswerable це правильна поведінка)');
    return;
  }
  const problems = validateAnswer(text, hits.map((h) => h.chunk));
  console.log('\nДжерела:');
  for (const id of new Set(citedIds(text))) {
    const h = hits.find((x) => x.chunk.id === id);
    console.log(`  ${h ? renderCitation({ chunkId: id, ...h.chunk }) : `[${id}] — НЕ ВИДАВАЛИ`}`);
  }
  console.log(`\nvalidateAnswer: проблем ${problems.length}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
  console.log(`токени: ${turn.usage.inputTokens} / ${turn.usage.outputTokens}`);
  if (problems.length > 0) process.exitCode = 1;
}

if (flag('--golden')) await golden();
else if (query === '') {
  console.error('Використання: npx tsx scripts/search.ts "<запит>" [--explain | --answer] | --golden');
  process.exitCode = 1;
} else if (flag('--answer')) await answer(query);
else {
  const r = await rankings(query);
  if (flag('--explain')) explain(r);
  else for (const h of fuse(index, r, 5)) console.log(`${renderCitation({ chunkId: h.chunk.id, ...h.chunk })}  cos ${h.cosine.toFixed(3)}  rrf ${h.rrf.toFixed(5)}`);
}
