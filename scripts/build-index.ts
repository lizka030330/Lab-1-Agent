/**
 * Побудова індексу (крок 04). Мережа тут потрібна, тому це scripts/, а не src/.
 *   npm run index                        — локальна Ollama (embeddinggemma-2:270m)
 *   npm run index -- --provider google   — Gemini, ключ із .env.local
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { chunkDocument, normalize, RULE } from '../src/rag/chunk';
import { geminiEmbedder, ollamaEmbedder, type Embedder } from '../src/rag/embed';
import { round6, saveIndex, sha256, type IndexedChunk, type IndexFile } from '../src/rag/store';

const CORPUS = 'corpus';
const OUT = 'data/index.json';
const NORMALIZATION = 'BOM прибрано, CRLF→LF, пробіли в кінці рядків прибрано';

const providerIdx = process.argv.indexOf('--provider');
const embedder: Embedder =
  providerIdx >= 0 && process.argv[providerIdx + 1] === 'google' ? geminiEmbedder(768) : ollamaEmbedder();

const started = performance.now();
const documents: IndexFile['documents'][number][] = [];
const chunks: IndexedChunk[] = [];

const files = readdirSync(CORPUS).filter((f) => /\.(md|txt)$/i.test(f)).sort();
if (files.length < 10 || files.length > 40) throw new Error(`у ${CORPUS}/ ${files.length} файлів, специфікація вимагає 10–40`);

for (const file of files) {
  const docId = file.replace(/\.(md|txt)$/i, ''); // імʼя файлу = id зі spec.md
  const text = normalize(readFileSync(join(CORPUS, file), 'utf8'));
  const parts = chunkDocument(docId, text, RULE);
  const vectors = await embedder.embedDocuments(parts.map((p) => p.text));
  parts.forEach((part, i) => {
    const vector = vectors[i];
    if (vector === undefined) throw new Error(`${part.id}: немає вектора`);
    chunks.push({ ...part, vector: vector.map(round6) });
  });
  documents.push({ id: docId, path: join(CORPUS, file), chars: text.length, sha256: sha256(text) });
  console.log(`  ${docId}: ${text.length} симв. → ${parts.length} фрагм.`);
}

saveIndex(OUT, {
  version: 1,
  builtAt: new Date().toISOString(),
  embedder: embedder.id,
  dimensions: embedder.dimensions,
  rule: RULE,
  normalization: NORMALIZATION,
  documents,
  chunks,
});

const seconds = (performance.now() - started) / 1000;
const lengths = chunks.map((c) => c.text.length).sort((a, b) => a - b);
const totalChars = documents.reduce((n, d) => n + d.chars, 0);
console.log(`
документів:    ${documents.length}
символів:      ${totalChars}
фрагментів:    ${chunks.length}
довжина:       медіана ${lengths[Math.floor(lengths.length / 2)]}, мін ${lengths[0]}, макс ${lengths[lengths.length - 1]} симв.
ембедер:       ${embedder.id}, ${embedder.dimensions} вимірів
${OUT}:        ${(statSync(OUT).size / 1024 / 1024).toFixed(1)} МБ
час побудови:  ${seconds.toFixed(1)} с
`);
