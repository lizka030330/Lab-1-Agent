/**
 * Формат індексу (крок 04): JSON у репозиторії, повний перебір на кроці 05.
 * Заголовок фіксує ембедер, розмірність, правило й нормалізацію — loadIndex
 * падає, якщо індекс зібрано не тим, чим ви зараз шукаєте.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import type { Chunk, ChunkRule } from './chunk';
import type { Embedder } from './embed';

export interface IndexedChunk extends Chunk {
  readonly vector: number[];
}

export interface IndexFile {
  readonly version: 1;
  readonly builtAt: string;
  readonly embedder: string;
  readonly dimensions: number;
  readonly rule: ChunkRule;
  /** Словами: що саме робить normalize(). Змінилося — індекс недійсний. */
  readonly normalization: string;
  readonly documents: { readonly id: string; readonly path: string; readonly chars: number; readonly sha256: string }[];
  readonly chunks: IndexedChunk[];
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

/** 6 знаків після коми: точності для косинуса вистачає, а файл менший у рази. */
export const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export function saveIndex(path: string, index: IndexFile): void {
  writeFileSync(path, `${JSON.stringify(index)}\n`, 'utf8');
}

export function loadIndex(path: string, embedder: Embedder): IndexFile {
  const index = JSON.parse(readFileSync(path, 'utf8')) as IndexFile;
  if (index.embedder !== embedder.id) {
    throw new Error(`індекс зібрано ембедером ${index.embedder}, а шукаєте ви ${embedder.id} — перебудуйте: npm run index`);
  }
  if (index.dimensions !== embedder.dimensions) {
    throw new Error(`розмірність індексу ${index.dimensions}, ембедера ${embedder.dimensions}`);
  }
  return index;
}
