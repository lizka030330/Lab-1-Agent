import { describe, expect, it } from 'vitest';
import { citedDocIds } from '../src/rag/cite';

describe('citedDocIds', () => {
  it('відповідь без цитат дає порожній масив', () => {
    expect(citedDocIds('Текст без цитат.')).toEqual([]);
  });

  it('дві цитати одного документа дають один docId', () => {
    const answer = 'Текст [korovai#0001] і ще [korovai#0002].';
    expect(citedDocIds(answer)).toEqual(['korovai']);
  });

  it('кілька id в одних дужках', () => {
    const answer = 'Текст [st-nicholas#0000, st-nicholas-day#0005] та [korovai#0001].';
    expect(citedDocIds(answer)).toEqual(['st-nicholas', 'st-nicholas-day', 'korovai']);
  });
});
