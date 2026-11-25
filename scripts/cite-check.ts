/**
 * Детермінована перевірка цитат глибокого дослідження (Лаб. 4, крок 04) — ДО будь-якої моделі.
 *   npx tsx scripts/cite-check.ts [docs/lab4/research-cites.json]
 * Число «цитат усього / не підтверджено» друкується завжди — навіть коли воно нуль. Є непідтверджені — код 1.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { check, type Cite } from '../src/research/cite';

const file = process.argv[2] ?? 'docs/lab4/research-cites.json';
const fork = resolve(process.env.LAB4_FORK_DIR ?? '../path-to-regexp');
const cites = (JSON.parse(readFileSync(file, 'utf8')) as { cites: Cite[] }).cites;
const bad = cites.map((c) => ({ c, why: check(c, fork) })).filter((r) => r.why !== null);
for (const r of bad) console.error(`${JSON.stringify(r.c)} — ${r.why}`);
console.log(`цитат: ${cites.length}, не підтверджено: ${bad.length}`);
if (bad.length > 0) process.exit(1);
