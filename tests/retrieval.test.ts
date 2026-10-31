import { describe, expect, it } from 'vitest';

import { REFUSE_BELOW_COSINE, isRefusal, shouldRefuse } from '../src/rag/answer';
import { buildBm25, searchBm25, tokenize } from '../src/rag/bm25';
import { renderCitation, validateAnswer } from '../src/rag/cite';
import { fakeEmbedder } from '../src/rag/embed';
import { rrf } from '../src/rag/rrf';
import { bm25From, hybridSearch } from '../src/rag/search';
import type { IndexedChunk, IndexFile } from '../src/rag/store';

describe('bm25 — токенізація першою', () => {
  it('бачить кирилицю', () => {
    expect(tokenize('Що дарують на Хануку?')).toEqual(['що', 'дарують', 'на', 'хануку']);
    expect(tokenize('Помилка E-418')).toEqual(['помилка', '418']);
  });
});

describe('rrf', () => {
  it('той самий розбір, що в методичці', () => {
    const fused = rrf([
      ['A', 'B', 'C'],
      ['C', 'A', 'D'],
    ]);
    expect(fused.map((r) => r.id)).toEqual(['A', 'C', 'B', 'D']);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 10); // 0,03252
    expect(fused[1]?.score).toBeCloseTo(1 / 63 + 1 / 61, 10); // 0,03227
    expect(fused[2]?.score).toBeCloseTo(1 / 62, 10); // 0,01613
    expect(fused[3]?.score).toBeCloseTo(1 / 63, 10); // 0,01587
  });

  it('ранги рахуються з одиниці', () => {
    expect(rrf([['A']])[0]?.score).toBeCloseTo(1 / 61, 10);
  });

  it('відсутній у списку документ не додає нічого', () => {
    expect(rrf([['A', 'B'], ['A']]).find((r) => r.id === 'B')?.score).toBeCloseTo(1 / 62, 10);
  });
});

describe('bm25', () => {
  const docs = [
    { id: 'c-1', text: 'Ханука ґелт: діти дарували вчителям невелику суму грошей.' },
    { id: 'c-2', text: 'Коровай печуть на весілля, гості дякують подарунками.' },
    { id: 'c-3', text: 'Писанку дарували на знак перемирʼя.' },
  ];
  const index = buildBm25(docs);

  it('знаходить рідкісний точний рядок', () => {
    expect(searchBm25(index, 'ґелт')[0]?.id).toBe('c-1');
  });

  it('нічого не повертає, коли спільних слів немає', () => {
    // стемінгу немає: «подарунок» ≠ «подарунками», «весільний» ≠ «весілля»
    expect(searchBm25(index, 'весільний подарунок')).toEqual([]);
  });
});

const mini: readonly Omit<IndexedChunk, 'vector'>[] = [
  { id: 'hanukkah#0000', docId: 'hanukkah', heading: '', start: 0, end: 60, text: 'Ханука ґелт: діти дарували вчителям невелику суму грошей.' },
  { id: 'korovai#0000', docId: 'korovai', heading: 'Обряд', start: 0, end: 55, text: 'Коровай печуть на весілля, гості дякують подарунками.' },
  { id: 'pysanka#0000', docId: 'pysanka', heading: '', start: 0, end: 36, text: 'Писанку дарували на знак перемирʼя.' },
];

async function miniIndex(): Promise<IndexFile> {
  const e = fakeEmbedder();
  const vectors = await e.embedDocuments(mini.map((c) => c.text));
  return {
    version: 1,
    builtAt: 'test',
    embedder: e.id,
    dimensions: e.dimensions,
    rule: { maxChars: 1200, minChars: 200, overlapChars: 150 },
    normalization: 'test',
    documents: [],
    chunks: mini.map((c, i) => ({ ...c, vector: vectors[i] ?? [] })),
  };
}

describe('гібридний пошук на мінікорпусі (підроблений ембедер)', () => {
  it('ставить фрагмент зі збігом слів першим і повертає ранги обох гілок', async () => {
    const index = await miniIndex();
    const hits = await hybridSearch(index, bm25From(index), fakeEmbedder(), 'Що таке ханука ґелт?');
    expect(hits[0]?.chunk.id).toBe('hanukkah#0000');
    expect(hits[0]?.rankWords).toBe(1);
    expect(hits[0]?.rankVector).toBe(1);
    expect(hits[0]?.rrf).toBeCloseTo(2 / 61, 10);
  });

  it('фрагмент без жодного слова запиту має rankWords = null', async () => {
    const index = await miniIndex();
    const hits = await hybridSearch(index, bm25From(index), fakeEmbedder(), 'ханука ґелт');
    expect(hits.find((h) => h.chunk.id === 'pysanka#0000')?.rankWords ?? null).toBeNull();
  });
});

describe('validateAnswer', () => {
  const served = [{ id: 'korovai#0003' }];

  it('ловить відповідь без цитати', () => {
    expect(validateAnswer('Гості дякували подарунками.', served).join(' ')).toContain('немає жодної цитати');
  });

  it('ловить цитату на невидане', () => {
    expect(validateAnswer('Гості дякували подарунками [korovai#0099].', served).join(' ')).toContain('не давали');
  });

  it('приймає цитату на видане', () => {
    expect(validateAnswer('Гості дякували подарунками [korovai#0003].', served)).toEqual([]);
  });

  it('рядок цитати веде до файлу й 0-based зсувів', () => {
    expect(renderCitation({ chunkId: 'korovai#0003', docId: 'korovai', heading: 'Обряд', start: 1240, end: 2010 })).toBe(
      '[korovai#0003] corpus/korovai.md › Обряд · символи 1240–2010',
    );
  });
});

describe('правило відмови', () => {
  it('відмова, коли косинус найкращого фрагмента нижчий за поріг; бал RRF не враховується', () => {
    expect(shouldRefuse(REFUSE_BELOW_COSINE - 0.001)).toBe(true);
    expect(shouldRefuse(REFUSE_BELOW_COSINE + 0.001)).toBe(false);
    expect(shouldRefuse(undefined)).toBe(true);
  });

  it('відкалібровані числа: q-23 (unanswerable) відмова, q-11 (найнижчий серед відповідних) — ні', () => {
    expect(shouldRefuse(0.7609)).toBe(true); // q-23, найвищий косинус серед unanswerable
    expect(shouldRefuse(0.7707)).toBe(false); // q-11, найнижчий косинус серед запитів із відповіддю
  });

  it('розпізнає текст відмови', () => {
    expect(isRefusal('У документах колекції цього немає.')).toBe(true);
    expect(isRefusal('Гості дякували подарунками [korovai#0003].')).toBe(false);
  });
});
