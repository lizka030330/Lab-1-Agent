import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/rag/bm25';

describe('tokenize apostrophe handling', () => {
  it('handles all three forms of apostrophe between letters and normalizes to ʼ (U+02BC)', () => {
    expect(tokenize("пам'ять")).toEqual(['памʼять']);
    expect(tokenize("пам’ять")).toEqual(['памʼять']);
    expect(tokenize("памʼять")).toEqual(['памʼять']);
    expect(tokenize("Пам'ять")).toEqual(['памʼять']);
    expect(tokenize("з'їзд")).toEqual(['зʼїзд']);
    expect(tokenize("об'єкт")).toEqual(['обʼєкт']);
    expect(tokenize("п'ять")).toEqual(['пʼять']);
  });

  it('ignores apostrophe at the beginning or end of a word', () => {
    expect(tokenize("'слово'")).toEqual(['слово']);
    expect(tokenize("’слово’")).toEqual(['слово']);
    expect(tokenize("ʼсловоʼ")).toEqual(['слово']);
    expect(tokenize("слово'")).toEqual(['слово']);
    expect(tokenize("слово’")).toEqual(['слово']);
    expect(tokenize("словоʼ")).toEqual(['слово']);
    expect(tokenize("'пам'ять'")).toEqual(['памʼять']);
  });

  it('drops single-letter tokens even with apostrophe', () => {
    expect(tokenize("о'")).toEqual([]);
    expect(tokenize("'о'")).toEqual([]);
    expect(tokenize("о")).toEqual([]);
  });
});
