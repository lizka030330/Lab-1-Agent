/**
 * ПАМʼЯТЬ ХАРНЕСА (Лаб. 4, крок 04): JSONL, строга схема, дописує ЛИШЕ цей код.
 * Модель пропонує запис (поле memory у чернетці звідника, схема MemoryProposal) — код валідує, проганяє
 * детерміновані відмови й лише тоді дописує. Читання в промпт — дві межі (K записів, B байтів) і перевірка
 * застарілості через git у тому репозиторії, який названо в полі repo. Падаємо ЗАКРИТО: помилка git = застаріле.
 *
 * Чому файл пише код, а не модель: Young, «Effective harnesses for long-running agents» (Anthropic, 26.11.2025) —
 * перелік тримали в JSON, «because the model is less likely to overwrite it».
 * Памʼять — КОНТЕКСТ, а не заборона: заборони живуть лише в правилах дозволів (readerTools, safePath).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

export const STORE_FILE = 'docs/lab4/memory/store.jsonl';
export const REJECT_LOG = 'docs/lab4/memory/rejected.jsonl';
export const MAX_TEXT = 400; // запис — твердження, не документ
export const MAX_NEWLINES = 2; // більше — це вже схоже на файл
export const MAX_CODE_RUN = 160; // фрагмент «коду» без пробілу-речення довший за це — схоже на вставку файлу
export const PROMPT_ENTRIES = 20; // межа 1: записів у промпт
export const PROMPT_BYTES = 6000; // межа 2: байтів у промпт

export const entry = z
  .object({
    at: z.string().min(1),
    /** Рішення / обмеження / результат задачі. Більше видів не буває. */
    kind: z.enum(['decision', 'constraint', 'outcome']),
    text: z.string().min(1).max(MAX_TEXT),
    /** Коміт, на момент якого твердження було правдою (зазвичай HEAD при записі). */
    sha: z.string().regex(/^[0-9a-f]{7,40}$/),
    /** У ЯКОМУ репозиторії живуть paths. Без цього git перевіряє не той репозиторій. */
    repo: z.enum(['course', 'fork']),
    /** Файли, яких твердження стосується; порожній масив — глобальне твердження. */
    paths: z.array(z.string().min(1)).max(8),
    /** Звідки взято: вимір, прогін, permalink. Саме тут живуть посилання й хеші. */
    source: z.string().min(1).max(300),
  })
  .strict();
export type Entry = z.infer<typeof entry>;

/** Те, що може запропонувати модель: без at і sha — їх ставить код (час і HEAD у названому репозиторії). */
export const MemoryProposal = z
  .object({
    kind: z.enum(['decision', 'constraint', 'outcome']),
    text: z.string().min(1).max(MAX_TEXT),
    repo: z.enum(['course', 'fork']),
    paths: z.array(z.string().min(1)).max(8),
  })
  .strict();
export type MemoryProposalT = z.infer<typeof MemoryProposal>;

export type Roots = { course: string; fork: string };
export const defaultRoots = (): Roots => ({ course: resolve('.'), fork: resolve(process.env.LAB4_FORK_DIR ?? '../path-to-regexp') });

/**
 * Детерміновані відмови. Перевіряється ЛИШЕ text: посилання й хеші живуть у source і sha,
 * інакше фільтр відхилив би власний запис про зелений прогін. Повертає причину або null.
 * Навмисно грубі: зайва відмова коштує переформулювання, пропущений ключ — ротації ключа.
 */
export function reject(e: Pick<Entry, 'text'>): string | null {
  if ((e.text.match(/\n/g)?.length ?? 0) > MAX_NEWLINES) return 'схоже на цілий файл (забагато переводів рядка)';
  if (/[{};]\s*\n|^\s*(import|export|function|const|class)\s/m.test(e.text) && e.text.length > MAX_CODE_RUN) return 'схоже на фрагмент коду';
  if (/[A-Za-z0-9_\-+/]{32,}={0,2}/.test(e.text)) return 'схоже на ключ або токен (довгий непробільний літерал)';
  if (/\b(api[_-]?key|token|secret|password|passwd)\b/i.test(e.text) && /[=:]\s*\S{8,}/.test(e.text)) return 'схоже на секрет у форматі ключ=значення';
  if (/\.env\b/.test(e.text) && /[=:]\s*\S{8,}/.test(e.text)) return 'схоже на вміст .env';
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(e.text)) return 'схоже на персональні дані (email)';
  return null;
}

function logReject(e: unknown, why: string, file = REJECT_LOG): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), why, text: (e as { text?: unknown })?.text }) + '\n');
}

/** ЄДИНЕ місце, яке дописує у store. Модель сюди не дотягується. Невалідне — кидає (ненульовий код у CLI). */
export function remember(e: Entry, file = STORE_FILE, rejectLog = REJECT_LOG): void {
  const parsed = entry.parse(e);
  const why = reject(parsed);
  if (why !== null) {
    logReject(parsed, why, rejectLog); // відмова — подія, яку видно
    throw new Error(`запис відхилено: ${why}`);
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(parsed) + '\n');
}

export function headSha(repoDir: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
}

/** Пропозиція моделі → запис: код ставить at і sha (HEAD названого репозиторію) і source. */
export function fromProposal(p: MemoryProposalT, source: string, roots: Roots = defaultRoots(), now = new Date()): Entry {
  const ok = MemoryProposal.parse(p);
  return { at: now.toISOString(), ...ok, sha: headSha(roots[ok.repo]), source };
}

/**
 * Чи були коміти ПІСЛЯ sha, що торкалися шляху, — у ТОМУ репозиторії, який названо в полі repo.
 * Падаємо ЗАКРИТО: невідомий коміт, не той репозиторій або будь-яка помилка git — «застаріле».
 */
export function stale(e: Entry, roots: Roots = defaultRoots()): boolean {
  if (e.paths.length === 0) return false; // глобальне твердження — перевіряти нічим
  const cwd = roots[e.repo];
  return e.paths.some((p) => {
    try {
      const after = execFileSync('git', ['log', '--format=%H', `${e.sha}..HEAD`, '--', p], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return after.trim() !== ''; // непорожньо = після sha файл змінювали
    } catch {
      return true; // не змогли перевірити — вважаємо застарілим
    }
  });
}

export function readAll(file = STORE_FILE): Entry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => entry.parse(JSON.parse(l)));
}

export type Recall = { text: string; used: number; total: number; staleDropped: number; staleIds: string[]; cutEntries: number; cutBytes: number };

/**
 * Читання в промпт: застарілі НЕ вантажимо (застаріле впевнено бреше — гірше, ніж відсутнє),
 * дві межі, найновіші першими, і ЧИСЛА про те, що обрізано.
 */
export function recall(opts: { file?: string; roots?: Roots; maxEntries?: number; maxBytes?: number } = {}): Recall {
  const all = readAll(opts.file);
  const roots = opts.roots ?? defaultRoots();
  const maxEntries = opts.maxEntries ?? PROMPT_ENTRIES;
  const maxBytes = opts.maxBytes ?? PROMPT_BYTES;
  const staleIds: string[] = [];
  const fresh = all.filter((e) => {
    const s = stale(e, roots);
    if (s) staleIds.push(`${e.at} ${e.kind}`);
    return !s;
  });

  const lines: string[] = [];
  let bytes = 0;
  let cutBytes = 0;
  let cutEntries = 0;
  for (const e of fresh.slice().reverse()) {
    const line = `- [${e.kind}] ${e.text} (${e.repo}@${e.sha.slice(0, 7)}; ${e.source})`;
    const size = Buffer.byteLength(line, 'utf8');
    if (lines.length >= maxEntries || bytes + size > maxBytes) {
      cutBytes += size;
      cutEntries += 1;
      continue;
    }
    lines.push(line);
    bytes += size;
  }
  return { text: lines.join('\n'), used: lines.length, total: all.length, staleDropped: staleIds.length, staleIds, cutEntries, cutBytes };
}
