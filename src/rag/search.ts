/**
 * Гібридний пошук (крок 05): топ-20 за косинусом + топ-20 за BM25 → RRF → топ-5.
 * Вектор запиту рахує той самий ембедер, що й індекс (loadIndex це перевіряє).
 */
import { cosineSimilarity } from 'ai';

import { buildBm25, searchBm25, type Bm25Index } from './bm25';
import type { Embedder } from './embed';
import { rrf, RRF_K } from './rrf';
import type { IndexedChunk, IndexFile } from './store';

export const DEPTH = 20; // скільки беремо з кожної гілки ДО злиття

export interface Hit {
  readonly chunk: IndexedChunk;
  readonly rrf: number;
  readonly cosine: number;
  /** Ранги з 1; null — цієї гілки фрагмент не знайшла (у межах DEPTH). Саме це йде в retrieval.md. */
  readonly rankVector: number | null;
  readonly rankWords: number | null;
}

/** Повні ранжування обох гілок — для --explain і калібрування; hybridSearch бере з них DEPTH. */
export interface Rankings {
  readonly vector: { id: string; cosine: number }[];
  readonly words: { id: string; score: number }[];
}

export function bm25From(index: IndexFile): Bm25Index {
  // шукаємо по тому ж тексту, що й ембедимо: заголовок усередині фрагмента — навмисно
  return buildBm25(index.chunks.map((c) => ({ id: c.id, text: c.text })));
}

export function rankAll(index: IndexFile, words: Bm25Index, queryVector: readonly number[], query: string): Rankings {
  const vector = index.chunks
    .map((c) => ({ id: c.id, cosine: cosineSimilarity([...queryVector], c.vector) }))
    .sort((a, b) => b.cosine - a.cosine || a.id.localeCompare(b.id));
  return { vector, words: searchBm25(words, query, index.chunks.length) };
}

export function fuse(index: IndexFile, r: Rankings, topK = 5): Hit[] {
  const vectorList = r.vector.slice(0, DEPTH).map((x) => x.id);
  const wordList = r.words.slice(0, DEPTH).map((x) => x.id);
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const cosines = new Map(r.vector.map((x) => [x.id, x.cosine]));
  const rank = (list: readonly string[], id: string): number | null => {
    const i = list.indexOf(id);
    return i < 0 ? null : i + 1;
  };

  const hits: Hit[] = [];
  for (const { id, score } of rrf([vectorList, wordList], RRF_K).slice(0, topK)) {
    const chunk = byId.get(id);
    if (chunk === undefined) throw new Error(`RRF повернув невідомий фрагмент ${id}`);
    hits.push({ chunk, rrf: score, cosine: cosines.get(id) ?? 0, rankVector: rank(vectorList, id), rankWords: rank(wordList, id) });
  }
  return hits;
}

export async function hybridSearch(
  index: IndexFile,
  words: Bm25Index,
  embedder: Embedder,
  query: string,
  topK = 5,
): Promise<Hit[]> {
  const qv = await embedder.embedQuery(query);
  return fuse(index, rankAll(index, words, qv, query), topK);
}
