/**
 * Початкові записи памʼяті харнеса (Лаб. 4, крок 04). Запускаю Я після перегляду кожного рядка:
 *   npx tsx scripts/memory/seed.ts
 * Пише ЛИШЕ через remember() — схема й детерміновані відмови діють і тут.
 * Свіжі записи беруть sha = HEAD названого репозиторію в момент запуску (тому запускати ПІСЛЯ коміту коду кроку 04).
 * Два записи навмисно мають старий sha — правдиві тоді, хибні тепер: на них видно перевірку застарілості.
 * Два записи навмисно заборонені — на них видно відмови (журнал docs/lab4/memory/rejected.jsonl).
 */
import { existsSync } from 'node:fs';

import { defaultRoots, headSha, remember, STORE_FILE, type Entry } from '../../src/memory/store';

if (existsSync(STORE_FILE)) throw new Error(`${STORE_FILE} уже існує — seed запускається один раз`);
const roots = defaultRoots();
const at = new Date().toISOString();
const HEAD = { course: headSha(roots.course), fork: headSha(roots.fork) };

const fresh: Omit<Entry, 'at' | 'sha'>[] = [
  {
    kind: 'decision', repo: 'course', paths: ['scripts/multi/ask.ts', 'src/multi/synth.ts'],
    text: 'Твердження про КОД підкріплювати доказом path#L<рядок>; commit:<sha> — лише для тверджень про історію. Доказ-коміт показує лише тему й статистику, і верифікатор ставить unknown.',
    source: 'single-v3 q2, q3 (24.11.2026): обидва заблоковано через доказ-коміт — docs/lab4/multiagent.md, таблиця чисел',
  },
  {
    kind: 'decision', repo: 'course', paths: ['src/multi/fanout.ts'],
    text: 'Гілка читає stepsPerBranch-1 кроків з інструментами, а підсумок робиться окремим запитом без інструментів: toolChoice none і activeTools [] Gemini на останньому кроці ігнорує.',
    source: 'траси q1-diag, q1-diag2, q1-diag3 (24.11.2026) — docs/lab4/multiagent.md, розділ «Що зламалося»',
  },
  {
    kind: 'constraint', repo: 'fork', paths: ['package.json'],
    text: 'TypeScript 7.0.2 у форку — нативна збірка без компіляторного API: dependency-cruiser і TSConfigPreprocessor Stryker на ньому падають; інструменти аналізу ставити окремо з typescript ^5.',
    source: 'docs/lab4/context.md §4; docs/lab4/characterization.md §5 (stryker-run-1.txt)',
  },
  {
    kind: 'constraint', repo: 'fork', paths: ['src/index.ts'],
    text: 'На master форка в src/index.ts немає жодного try/catch: match() кидає неперехоплений URIError на битому %-кодуванні. Виправлення кроку 02 живе лише в гілці lab4/change.',
    source: 'docs/lab4/context.md §5 п.3; docs/lab4/change.md §6',
  },
  {
    kind: 'outcome', repo: 'fork', paths: ['src/index.ts'],
    text: 'Повна історія src/index.ts видна лише з git log --follow -M30% (154 коміти з 2012); з типовим порогом вона обривається на перейменуванні 2019 року.',
    source: 'docs/lab4/context.md §3 (коміт 4f33bc4)',
  },
  {
    kind: 'outcome', repo: 'course', paths: [],
    text: 'Крок 03: розгалуження на 4 гілки скоротило фазу читання на 59 % при тій самій якості фактів 0,80; час до відповіді визначає послідовний локальний верифікатор.',
    source: 'docs/lab4/multiagent.md, вердикт (fanout-v3 проти single-v3, 24.11.2026)',
  },
];

const deliberatelyStale: Entry[] = [
  {
    at, kind: 'constraint', repo: 'fork', sha: 'c439054', paths: ['src/characterization.spec.ts'],
    text: 'У форку немає жодного тесту на бите %-кодування в match().',
    source: 'context.md §6 на нульовій точці c439054 — ПРАВДА ТОДІ, хибне після коміту 16f2a46 (характеризаційні тести)',
  },
  {
    at, kind: 'decision', repo: 'course', sha: '1a7ff70', paths: ['src/multi/fanout.ts'],
    text: 'Підсумок гілки читання береться з тексту останнього кроку generateText.',
    source: 'код кроку 03 на 1a7ff70 — ПРАВДА ТОДІ, хибне після 764b6a8 (окремий запит-підсумок)',
  },
];

const deliberatelyForbidden: Entry[] = [
  { at, kind: 'outcome', repo: 'course', sha: HEAD.course, paths: [], text: 'Тестовий ключ для демонстрації відмови: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', source: 'демонстрація відмови: фальшивий «ключ»' },
  { at, kind: 'constraint', repo: 'fork', sha: HEAD.fork, paths: ['src/index.ts'], text: 'рядок 1\nрядок 2\nрядок 3\nрядок 4', source: 'демонстрація відмови: «цілий файл»' },
];

let ok = 0;
for (const e of fresh) { remember({ at, sha: HEAD[e.repo], ...e }); ok++; }
for (const e of deliberatelyStale) { remember(e); ok++; }
let rejected = 0;
for (const e of deliberatelyForbidden) {
  try { remember(e); throw new Error('ЗАБОРОНЕНИЙ запис пройшов — відмови не працюють'); } catch (err) {
    if (err instanceof Error && err.message.startsWith('ЗАБОРОНЕНИЙ')) throw err;
    rejected++;
    console.log(`відхилено як слід: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`записано: ${ok}; відхилено: ${rejected}; course@${HEAD.course.slice(0, 7)} fork@${HEAD.fork.slice(0, 7)}`);
