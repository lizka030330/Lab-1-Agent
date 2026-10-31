/**
 * Завантажує корпус лабораторної 2 (25 статей української Вікіпедії, CC BY-SA 4.0)
 * у docs/lab2/corpus/<id>.md. Ходить у мережу — запускати лише вручну:
 *
 *   npx tsx scripts/fetch-corpus.ts
 *
 * Уже завантажені файли пропускає: повторний запуск продовжує з місця зупинки.
 * Список id і назв — таблиця розділу 2 docs/lab2/spec.md.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const DOCS: ReadonlyArray<readonly [string, string]> = [
  ['gift', 'Подарунок'],
  ['christmas', 'Різдво Христове'],
  ['new-year', 'Новий рік'],
  ['st-nicholas-day', 'День Святого Миколая'],
  ['st-nicholas', 'Святий Миколай'],
  ['santa-claus', 'Санта-Клаус'],
  ['hanukkah', 'Ханука'],
  ['diwali', 'Дівалі'],
  ['chinese-new-year', 'Китайський новий рік'],
  ['valentines-day', 'День святого Валентина'],
  ['valentine-card', 'Валентинка'],
  ['easter', 'Великдень'],
  ['pysanka', 'Писанка'],
  ['wedding', 'Весілля'],
  ['korovai', 'Коровай'],
  ['wedding-anniversary', 'Річниця весілля'],
  ['birthday', 'День народження'],
  ['womens-day', 'Міжнародний жіночий день'],
  ['flower-language', 'Мова квітів'],
  ['potlatch', 'Потлач'],
  ['kula', 'Кула (обмін)'],
  ['etiquette', 'Етикет'],
  ['halloween', 'Хелловін'],
  ['ramadan', 'Рамадан'],
  ['eid-al-adha', 'Курбан-байрам'],
];

const OUT = 'docs/lab2/corpus';
const LICENSE = 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)';
const PAUSE_MS = 5000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Page {
  title?: string;
  extract?: string;
  missing?: string;
}

/** Один запит до API з повтором: Вікіпедія відповідає не-JSON, коли запитів забагато. */
async function fetchPage(title: string): Promise<Page> {
  const url =
    'https://uk.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=' +
    encodeURIComponent(title);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'lab2-student/1.0 (navchalnyi proekt)' } });
    const text = await res.text();
    if (text.startsWith('{')) {
      const pages = (JSON.parse(text) as { query: { pages: Record<string, Page> } }).query.pages;
      const page = Object.values(pages)[0];
      if (page) return page;
    }
    const wait = 30_000 * attempt;
    console.warn(`  ліміт для «${title}», спроба ${attempt} з 4 — чекаю ${wait / 1000} с`);
    await sleep(wait);
  }
  throw new Error(`не вдалося завантажити «${title}» — запустіть скрипт ще раз пізніше`);
}

mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
let downloaded = 0;

for (const [id, title] of DOCS) {
  const file = `${OUT}/${id}.md`;
  if (existsSync(file)) {
    console.log(`вже є ${id}`);
    continue;
  }
  await sleep(PAUSE_MS);
  const page = await fetchPage(title);
  const extract = page.extract ?? '';
  if (page.missing !== undefined || extract === '') throw new Error(`статті «${title}» немає`);
  const realTitle = page.title ?? title;
  const source = `https://uk.wikipedia.org/wiki/${encodeURIComponent(realTitle.replaceAll(' ', '_'))}`;
  const header = [
    '---',
    `id: ${id}`,
    `title: ${realTitle}`,
    `source: ${source}`,
    `license: ${LICENSE}`,
    `retrieved: ${today}`,
    '---',
    '',
  ].join('\n');
  writeFileSync(file, `${header}${extract.trim()}\n`, 'utf8');
  downloaded++;
  console.log(`ok  ${id.padEnd(20)} ${realTitle} — ${extract.length} симв.`);
}

console.log(`\nЗавантажено зараз: ${downloaded}; усього в ${OUT}: ${DOCS.length} очікується`);