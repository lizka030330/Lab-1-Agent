/**
 * Базова лінія без пошуку (Лаб. 2, крок 01). ХОДИТЬ У МЕРЕЖУ — лише вручну:
 *
 *   npx tsx --env-file=.env.local scripts/baseline.ts docs/lab2/golden/queries.jsonl
 *
 * Модель отримує ТІЛЬКИ текст питання: жодного документа, фрагмента чи інструмента.
 * Виклик — адаптер chatCompletionsModel з Лаб. 1, облік — src/cost.ts (та сама методика,
 * що буде на кроці 06). Сирі відповіді пишуться в docs/lab2/baseline-run.json;
 * вердикт (correct / partial / wrong / refused) ставить людина за правилом spec.md, розділ 6,
 * скрипт лише підказує.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { chatCompletionsModel } from '../src/agent/adapters';
import { addUsage, priceUsd, ZERO_USAGE, type Usage } from '../src/cost';
import { CATALOG } from '../src/models';
import type { Entry } from './validate-golden';

/** Той самий системний промпт піде на крок 06 — лише з фрагментами документів. */
export const SYSTEM = [
  'Ти довідник з традицій і етикету подарунків.',
  'Відповідай українською, коротко: 1–3 речення.',
  'Якщо не знаєш точної відповіді, прямо скажи, що не знаєш, і нічого не вигадуй.',
].join('\n');

const REFUSAL = /не знаю|не маю (точної )?інформац|немає (точної )?інформац|не можу (точно )?відповісти|не вдалося знайти|невідомо/i;
const PAUSE_MS = 5000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Підказка до вердикту: скільки фактів з expected дослівно є у відповіді. Остаточний вердикт — за людиною. */
export function suggestVerdict(entry: Entry, answer: string): string {
  const refused = REFUSAL.test(answer);
  if (entry.tags.includes('unanswerable')) return refused ? 'refused (правильно)' : 'wrong?';
  if (refused) return 'refused';
  const facts = Array.isArray(entry.expected) ? entry.expected : [];
  if (facts.length === 0) return 'перевірити вручну';
  const found = facts.filter((f) => answer.toLowerCase().includes(f.toLowerCase())).length;
  if (found === facts.length) return 'correct?';
  return found > 0 ? `partial? (${found}/${facts.length})` : 'wrong? (0 фактів дослівно)';
}

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY порожній: заповніть .env.local');
const spec = CATALOG['gemini-3.5-flash-lite'];
const model = chatCompletionsModel({
  url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  model: spec.id,
  headers: { authorization: `Bearer ${key}` },
});

const file = process.argv[2] ?? 'docs/lab2/golden/queries.jsonl';
const entries = readFileSync(file, 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Entry);

interface Row {
  readonly id: string;
  readonly tags: readonly string[];
  readonly answer: string;
  readonly suggested: string;
  readonly usage: Usage;
  readonly ms: number;
}

const rows: Row[] = [];
let total: Usage = ZERO_USAGE;

for (const entry of entries) {
  await sleep(PAUSE_MS);
  const started = performance.now();
  try {
    const turn = await model(SYSTEM, [{ role: 'user', text: entry.query }], []);
    const ms = Math.round(performance.now() - started);
    total = addUsage(total, turn.usage);
    const answer = turn.text.trim();
    rows.push({ id: entry.id, tags: entry.tags, answer, suggested: suggestVerdict(entry, answer), usage: turn.usage, ms });
    console.log(`ok  ${entry.id}  ${ms} мс  ${answer.replace(/\s+/g, ' ').slice(0, 90)}`);
  } catch (error) {
    // 429 / 503: не крутимо далі, щоб не спалити квоту; збережене нижче не пропаде
    console.error(`${entry.id} перервано:`, error instanceof Error ? error.message.slice(0, 200) : error);
    break;
  }
}

const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
const median = sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0);
const cost = priceUsd(spec, total);

writeFileSync(
  'docs/lab2/baseline-run.json',
  `${JSON.stringify({ date: new Date().toISOString(), model: spec.id, system: SYSTEM, file, total, costUsd: cost, medianMs: median, rows }, null, 2)}\n`,
  'utf8',
);

console.log('\n| id | tags | підказка вердикту | що відповіла модель (коротко) |');
console.log('|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.id} | ${r.tags.join(', ')} | ${r.suggested} | ${r.answer.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 140)} |`);
}
console.log(`\nЗапитів: ${rows.length} з ${entries.length}; токени ${total.inputTokens} / ${total.outputTokens}; $ за прайсом ${cost.toFixed(6)}; медіана ${(median / 1000).toFixed(1)} с`);
console.log('Сирі відповіді: docs/lab2/baseline-run.json');
