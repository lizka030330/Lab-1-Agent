import { describe, expect, it } from 'vitest';

import { chunkDocument, normalize, parseHeading, RULE } from '../src/rag/chunk';

const doc = `# Інструкція\n\n## Розділ 1\n${'А'.repeat(900)}\n\n${'Б'.repeat(900)}\n\n## Розділ 2\nКоротко.\n`;
const wiki = `Вступ статті.\n\n== Традиції ==\n${'В'.repeat(700)}\n${'Г'.repeat(700)}\n\n=== Україна ===\nПідрозділ.\n`;

describe('chunkDocument', () => {
  it('тримає інваріант зсувів', () => {
    for (const source of [doc, wiki]) {
      const text = normalize(source);
      for (const c of chunkDocument('doc-01', source)) expect(c.text).toBe(text.slice(c.start, c.end));
    }
  });

  it('не перевищує максимум', () => {
    for (const c of chunkDocument('doc-01', doc)) expect(c.end - c.start).toBeLessThanOrEqual(RULE.maxChars);
  });

  it('веде шлях заголовків', () => {
    const headings = chunkDocument('doc-01', doc).map((c) => c.heading);
    expect(headings).toContain('Інструкція › Розділ 1');
    expect(headings).toContain('Інструкція › Розділ 2');
  });

  it('розпізнає заголовки Вікіпедії «== … ==» і їхню вкладеність', () => {
    expect(parseHeading('== Традиції ==')).toEqual({ level: 1, title: 'Традиції' });
    expect(parseHeading('=== Україна ===')).toEqual({ level: 2, title: 'Україна' });
    expect(parseHeading('a == b')).toBeNull();
    const headings = chunkDocument('wiki', wiki).map((c) => c.heading);
    expect(headings).toContain('Традиції');
    expect(headings).toContain('Традиції › Україна');
  });

  it('детермінований: ті самі id на тому самому вході', () => {
    const a = chunkDocument('doc-01', doc).map((c) => c.id);
    const b = chunkDocument('doc-01', doc).map((c) => c.id);
    expect(a).toEqual(b);
  });
});

describe('порожні заголовки', () => {
  const src = `Вступ.\n\n== Про обряди ==\n\n\n=== У Корані ===\n${'Д'.repeat(300)}\n\n== Примітки ==\n\n\n`;

  it('розділ із самого заголовка не стає окремим фрагментом', () => {
    const chunks = chunkDocument('d', src);
    const headingOnly = chunks.filter((c) => {
      const [first = '', ...rest] = c.text.trim().split('\n');
      return parseHeading(first) !== null && rest.join('').trim() === '';
    });
    expect(headingOnly).toEqual([]);
    expect(chunks.some((c) => c.text.startsWith('== Про обряди ==') && c.text.includes('ДДД'))).toBe(true);
  });

  it('інваріант зсувів зберігається', () => {
    const text = normalize(src);
    for (const c of chunkDocument('d', src)) expect(c.text).toBe(text.slice(c.start, c.end));
  });
});
