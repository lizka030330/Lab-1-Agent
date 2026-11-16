import { describe, expect, it } from 'vitest';

import { Chunk, chunkStats } from '../src/rag/chunk';

describe('chunkStats', () => {
  it('повертає нулі для порожнього масиву', () => {
    expect(chunkStats([])).toEqual({ count: 0, avgChars: 0, maxChars: 0 });
  });

  it('обчислює статистику для трьох фрагментів заданої довжини', () => {
    const chunks: Chunk[] = [
      { id: '1', docId: 'doc', heading: '', start: 0, end: 10, text: '1234567890' },
      { id: '2', docId: 'doc', heading: '', start: 10, end: 30, text: '12345678901234567890' },
      { id: '3', docId: 'doc', heading: '', start: 30, end: 55, text: '1234567890123456789012345' },
    ];
    expect(chunkStats(chunks)).toEqual({ count: 3, avgChars: 18, maxChars: 25 });
  });
});
