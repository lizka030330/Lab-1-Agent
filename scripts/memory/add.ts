/**
 * Додати запис у памʼять харнеса ПІСЛЯ мого перегляду (Лаб. 4, крок 04):
 *   npx tsx scripts/memory/add.ts --kind decision --repo fork --paths src/index.ts --source "…" --text "…"
 *   npx tsx scripts/memory/add.ts --from-proposed 3     перенести 3-й рядок docs/lab4/memory/proposed.jsonl (переглянутий)
 * Пише лише через remember(): схема й детерміновані відмови діють завжди.
 */
import { readFileSync } from 'node:fs';

import { defaultRoots, entry, headSha, remember } from '../../src/memory/store';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const n = arg('from-proposed');
if (n) {
  const line = readFileSync('docs/lab4/memory/proposed.jsonl', 'utf8').split('\n').filter(Boolean)[Number(n) - 1];
  if (!line) throw new Error(`рядка ${n} у proposed.jsonl немає`);
  const e = entry.parse(JSON.parse(line));
  remember({ ...e, at: new Date().toISOString(), source: e.source.replace('; не переглянуто', '; переглянуто й прийнято мною') });
} else {
  const repo = arg('repo') as 'course' | 'fork';
  remember(entry.parse({
    at: new Date().toISOString(), kind: arg('kind'), repo, sha: arg('sha') ?? headSha(defaultRoots()[repo]),
    paths: (arg('paths') ?? '').split(',').filter(Boolean), source: arg('source'), text: arg('text'),
  }));
}
console.log('записано');
