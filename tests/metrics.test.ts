import { describe, expect, it } from 'vitest';

import {
  docsAtK,
  mean,
  ndcgAtK,
  proportionCI95,
  recallAtK,
  reciprocalRank,
  transitions,
  type Hit,
} from '../src/metrics';

const hit = (docId: string, chunkId: string): Hit => ({ docId, chunkId });

// Пошук віддав чотири фрагменти; перші два — з одного документа.
const hits: Hit[] = [hit('doc-07', 'c-71'), hit('doc-07', 'c-72'), hit('doc-02', 'c-20'), hit('doc-09', 'c-90')];

describe('docsAtK', () => {
  it('склеює фрагменти одного документа і тримає порядок', () => {
    expect(docsAtK(hits, 4)).toEqual(['doc-07', 'doc-02', 'doc-09']);
  });

  it('k рахує ФРАГМЕНТИ, а не документи', () => {
    // топ-2 фрагменти — обидва з doc-07, тож документів усього один
    expect(docsAtK(hits, 2)).toEqual(['doc-07']);
  });
});

describe('recall@k', () => {
  it('частка потрібних документів серед знайдених', () => {
    expect(recallAtK(hits, ['doc-02', 'doc-09'], 4)).toBeCloseTo(1, 10);
    expect(recallAtK(hits, ['doc-02', 'doc-33'], 4)).toBeCloseTo(0.5, 10);
    expect(recallAtK(hits, ['doc-33'], 4)).toBe(0);
  });

  it('дублі фрагментів не накручують recall', () => {
    expect(recallAtK(hits, ['doc-07'], 4)).toBe(1);
  });

  it('для unanswerable не визначено — це помилка виміру, а не нуль', () => {
    expect(() => recallAtK(hits, [], 4)).toThrow(RangeError);
  });
});

describe('MRR', () => {
  it('рахує ранг першого влучання по фрагментах', () => {
    expect(reciprocalRank(hits, ['doc-07'], 4)).toBeCloseTo(1, 10);
    expect(reciprocalRank(hits, ['doc-02'], 4)).toBeCloseTo(1 / 3, 10);
    expect(reciprocalRank(hits, ['doc-09'], 4)).toBeCloseTo(1 / 4, 10);
  });

  it('немає влучання в топ-k — рівно 0, а запит із підрахунку не зникає', () => {
    expect(reciprocalRank(hits, ['doc-09'], 2)).toBe(0);
    expect(mean([1, 0])).toBeCloseTo(0.5, 10);
  });
});

describe('nDCG@k', () => {
  it('ідеальний порядок дає 1', () => {
    expect(ndcgAtK(hits, { 'doc-07': 2, 'doc-02': 1 }, 4)).toBeCloseTo(1, 10);
  });

  it('той самий набір у гіршому порядку дає менше', () => {
    const worse = ndcgAtK(hits, { 'doc-07': 1, 'doc-02': 2 }, 4);
    expect(worse).toBeLessThan(1);
    expect(worse).toBeGreaterThan(0);
  });
});

describe('інтервал для частки', () => {
  it('ширшає, коли запитів менше', () => {
    const small = proportionCI95(12, 17);
    const big = proportionCI95(120, 170);
    expect(small.halfWidth).toBeGreaterThan(big.halfWidth);
  });

  it('межі не виходять за [0; 1]', () => {
    const edge = proportionCI95(17, 17);
    expect(edge.lo).toBeLessThanOrEqual(1);
    expect(edge.hi).toBe(1);
  });

  it('n = 0 — це не 0%, а відсутній вимір', () => {
    expect(() => proportionCI95(0, 0)).toThrow(RangeError);
  });
});

describe('переходи вердиктів', () => {
  it('рахує і приріст, і регресії', () => {
    const rows = transitions(
      { 'q-01': 'wrong', 'q-02': 'wrong', 'q-03': 'correct' },
      { 'q-01': 'correct', 'q-02': 'correct', 'q-03': 'wrong' },
    );
    expect(rows[0]).toEqual({ from: 'wrong', to: 'correct', ids: ['q-01', 'q-02'] });
    expect(rows).toContainEqual({ from: 'correct', to: 'wrong', ids: ['q-03'] });
  });
});
