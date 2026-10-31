import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { normalize } from '../src/rag/chunk';
import { fakeEmbedder } from '../src/rag/embed';
import { loadIndex, sha256, type IndexFile } from '../src/rag/store';

const index = JSON.parse(readFileSync('data/index.json', 'utf8')) as IndexFile;

describe('data/index.json', () => {
  it('має 10–40 документів', () => {
    expect(index.documents.length).toBeGreaterThanOrEqual(10);
    expect(index.documents.length).toBeLessThanOrEqual(40);
  });

  it('усі вектори однакової розмірності', () => {
    for (const c of index.chunks) expect(c.vector.length).toBe(index.dimensions);
  });

  it('кожен фрагмент розвʼязується назад у файл колекції', () => {
    const texts = new Map(index.documents.map((d) => [d.id, normalize(readFileSync(d.path, 'utf8'))]));
    for (const c of index.chunks) {
      const text = texts.get(c.docId);
      expect(text, `немає документа ${c.docId}`).toBeDefined();
      expect(text?.slice(c.start, c.end)).toBe(c.text);
    }
  });

  it('документи не змінювалися після побудови індексу', () => {
    for (const d of index.documents) {
      expect(sha256(normalize(readFileSync(d.path, 'utf8'))), `${d.id} змінився — npm run index`).toBe(d.sha256);
    }
  });

  it('loadIndex падає, якщо шукати не тим ембедером', () => {
    expect(() => loadIndex('data/index.json', fakeEmbedder())).toThrow('перебудуйте');
  });
});
