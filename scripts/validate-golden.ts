/**
 * Валідатор еталонного набору (крок 01).
 * Читає JSONL, перевіряє схему й пороги. Мережі не потребує.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { z } from 'zod';

export const TAGS = ['easy', 'hard', 'unanswerable', 'injection'] as const;

const Entry = z
  .object({
    id: z.string().min(1),
    query: z.string().min(1),
    expected: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    must_cite: z.array(z.string().min(1)),
    tags: z.array(z.enum(TAGS)).min(1),
  })
  .strict();

export type Entry = z.infer<typeof Entry>;

export interface Thresholds {
  readonly total: number;
  readonly unanswerable: number;
  readonly injection: number;
}

/** Пороги подання; на занятті запускайте з { total: 10, unanswerable: 2, injection: 1 }. */
export const SUBMIT: Thresholds = { total: 20, unanswerable: 3, injection: 2 };

/**
 * Перевіряє набір. Повертає перелік проблем — порожній означає «зелено».
 * knownIds — id документів корпусу; якщо передано, кожен must_cite має бути серед них (критерій A3).
 */
export function validateGolden(text: string, limits: Thresholds = SUBMIT, knownIds?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const entries: Entry[] = [];
  const seen = new Set<string>();

  // BOM і CRLF: файл міг бути створений у Windows-редакторі
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const n = i + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      problems.push(`рядок ${n}: не JSON`);
      return;
    }
    const parsed = Entry.safeParse(raw);
    if (!parsed.success) {
      problems.push(`рядок ${n}: ${z.prettifyError(parsed.error)}`);
      return;
    }
    const entry = parsed.data;
    if (seen.has(entry.id)) problems.push(`рядок ${n}: id "${entry.id}" повторюється`);
    seen.add(entry.id);

    const unanswerable = entry.tags.includes('unanswerable');
    if (unanswerable && entry.must_cite.length > 0) {
      problems.push(`${entry.id}: unanswerable не може мати must_cite`);
    }
    if (!unanswerable && entry.must_cite.length === 0) {
      problems.push(`${entry.id}: порожній must_cite — незрозуміло, що вважати цитатою`);
    }

    if (knownIds) {
      for (const id of entry.must_cite) {
        if (!knownIds.has(id)) problems.push(`${entry.id}: must_cite "${id}" немає в корпусі або в таблиці розділу 2 spec.md`);
      }
    }

    // витік: очікуваний факт дослівно всередині самого питання
    const facts = Array.isArray(entry.expected) ? entry.expected : [entry.expected];
    const q = entry.query.toLowerCase();
    for (const fact of facts) {
      const f = fact.toLowerCase().trim();
      if (f.length >= 12 && q.includes(f)) {
        problems.push(`${entry.id}: очікуваний факт дослівно є в тексті запиту`);
      }
    }
    entries.push(entry);
  });

  const count = (tag: Entry['tags'][number]) => entries.filter((e) => e.tags.includes(tag)).length;
  if (entries.length < limits.total) problems.push(`запитів ${entries.length}, потрібно ≥ ${limits.total}`);
  if (count('unanswerable') < limits.unanswerable) {
    problems.push(`unanswerable ${count('unanswerable')}, потрібно ≥ ${limits.unanswerable}`);
  }
  if (count('injection') < limits.injection) {
    problems.push(`injection ${count('injection')}, потрібно ≥ ${limits.injection}`);
  }
  return problems;
}

/** id документів із таблиці розділу 2 docs/lab2/spec.md (між «## 2.» і «## 3.»). */
export function specDocIds(specMarkdown: string): Set<string> {
  const section = specMarkdown.split(/^## 2\./m)[1]?.split(/^## 3\./m)[0] ?? '';
  const ids = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    const m = /^\|\s*([a-z0-9][a-z0-9-]*)\s*\|/.exec(line);
    if (m?.[1] && m[1] !== 'id') ids.add(m[1]);
  }
  return ids;
}

if (process.argv[1]?.endsWith('validate-golden.ts')) {
  const file = process.argv[2] ?? 'docs/lab2/golden/queries.jsonl';
  const corpusIds = new Set(
    readdirSync('corpus')
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3)),
  );
  // A3: id має бути і в таблиці розділу 2 специфікації, і серед файлів корпусу
  const specIds = specDocIds(readFileSync('docs/lab2/spec.md', 'utf8'));
  const knownIds = new Set([...corpusIds].filter((id) => specIds.has(id)));
  const problems = validateGolden(readFileSync(file, 'utf8'), SUBMIT, knownIds);
  if (problems.length > 0) {
    console.error(problems.map((p) => `  x ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('еталонний набір валідний');
}