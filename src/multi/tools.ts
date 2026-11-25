/**
 * Інструменти РОЛІ ЧИТАЧА (Лаб. 4, крок 03) — лише читальні, корінь — тека форка path-to-regexp.
 * Це і є «перелік дозволених інструментів» читача: інструмента запису тут немає й не може бути,
 * бо гілки отримують рівно цей обʼєкт (READER_TOOL_NAMES перевіряється тестом).
 *
 * Межі: шлях не виходить за корінь; .env*, .git/, node_modules/ — недоступні; git — лише фіксовані
 * читальні форми через execFile (без оболонки), аргументи валідуються; вивід обрізається.
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { tool } from 'ai';
import { z } from 'zod';

const run = promisify(execFile);

export const READER_TOOL_NAMES = ['list_files', 'read_file', 'grep', 'git_log', 'git_show_stat', 'git_rank'] as const;

const SKIP = new Set(['.git', 'node_modules', 'dist', 'coverage', '.stryker-tmp', 'reports']);
const MAX_LINES = 200;
const MAX_MATCHES = 40;

/** Шлях усередині кореня форка або помилка. Абсолютні шляхи, `..` і .env — відмова. */
export function safePath(root: string, p: string): string {
  if (isAbsolute(p)) throw new Error(`абсолютний шлях заборонено: ${p}`);
  const full = resolve(root, p);
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`шлях поза текою форка: ${p}`);
  const parts = rel.split(sep);
  if (parts.some((x) => x === '.git' || x === 'node_modules') || parts.some((x) => x.startsWith('.env'))) {
    throw new Error(`шлях недоступний читачеві: ${p}`);
  }
  // канонічність: символьне посилання всередині форка не має вивести назовні (крок 04)
  if (existsSync(full)) {
    const real = relative(realpathSync(root), realpathSync(full));
    if (real.startsWith('..') || isAbsolute(real)) throw new Error(`шлях веде поза форк через посилання: ${p}`);
  }
  return full;
}

function walk(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.env')) continue;
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full));
  }
}

const SHA = /^[0-9a-f]{7,40}$/;

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', root, '--no-pager', ...args], { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

export function readerTools(root: string) {
  return {
    list_files: tool({
      description: 'Перелік файлів форка (без node_modules, .git, dist, reports). Лише читання.',
      inputSchema: z.object({ dir: z.string().default('.') }),
      execute: async ({ dir }) => {
        const out: string[] = [];
        walk(root, safePath(root, dir), out);
        return out.sort().slice(0, 300).join('\n');
      },
    }),
    read_file: tool({
      description: `Прочитати файл форка з номерами рядків. Не більше ${MAX_LINES} рядків за раз (offset — з 1). Лише читання.`,
      inputSchema: z.object({ path: z.string(), offset: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(MAX_LINES).default(MAX_LINES) }),
      execute: async ({ path, offset, limit }) => {
        const lines = readFileSync(safePath(root, path), 'utf8').split('\n');
        return lines.slice(offset - 1, offset - 1 + limit).map((l, i) => `${offset + i}\t${l}`).join('\n') + `\n[рядків у файлі: ${lines.length}]`;
      },
    }),
    grep: tool({
      description: `Пошук регулярного виразу у файлах форка; повертає файл:рядок: текст (до ${MAX_MATCHES} збігів). Лише читання.`,
      inputSchema: z.object({ pattern: z.string().min(1).max(200), dir: z.string().default('.') }),
      execute: async ({ pattern, dir }) => {
        const re = new RegExp(pattern);
        const files: string[] = [];
        walk(root, safePath(root, dir), files);
        const hits: string[] = [];
        for (const f of files) {
          const lines = readFileSync(resolve(root, f), 'utf8').split('\n');
          for (const [i, l] of lines.entries()) {
            if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 160)}`);
            if (hits.length >= MAX_MATCHES) return hits.join('\n') + '\n[обрізано]';
          }
        }
        return hits.join('\n') || '(збігів немає)';
      },
    }),
    git_log: tool({
      description: 'Історія файлу: git log --follow -M30% (через перейменування), формат «sha дата тема», до 40 рядків. Лише читання.',
      inputSchema: z.object({ path: z.string(), n: z.number().int().min(1).max(40).default(20) }),
      execute: async ({ path, n }) => {
        safePath(root, path);
        return git(root, ['log', '--follow', '-M30%', `-n${n}`, '--format=%h %as %s', '--', path]);
      },
    }),
    git_show_stat: tool({
      description: 'Що змінив коміт: git show --stat для одного SHA (7–40 hex). Лише читання.',
      inputSchema: z.object({ sha: z.string().regex(SHA) }),
      execute: async ({ sha }) => git(root, ['show', '--stat', '--format=%h %as %an %s', sha]),
    }),
    git_rank: tool({
      description: 'Ранжування файлів за кількістю комітів, у яких вони змінювались (топ-N). Лише читання.',
      inputSchema: z.object({ n: z.number().int().min(1).max(20).default(10) }),
      execute: async ({ n }) => {
        const out = await git(root, ['log', '--format=format:', '--name-only']);
        const count = new Map<string, number>();
        for (const f of out.split('\n').filter(Boolean)) count.set(f, (count.get(f) ?? 0) + 1);
        return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f, c]) => `${c} ${f}`).join('\n');
      },
    }),
  };
}

/** Детерміноване витягання доказу для верифікатора: рядки файлу або тема коміту. Модель тут не бере участі. */
export async function fetchEvidence(root: string, ev: string): Promise<string> {
  const sha = ev.match(/^commit:([0-9a-f]{7,40})$/)?.[1];
  if (sha) {
    try {
      return await git(root, ['show', '--stat', '--format=%h %as %an %s', sha]);
    } catch {
      return `(коміт ${sha} не знайдено у форку)`;
    }
  }
  const m = ev.match(/^(.+?)#L(\d+)(?:-L?(\d+))?$/);
  if (!m || !m[1] || !m[2]) return `(доказ «${ev}» не у форматі path#L10, path#L10-L20 або commit:<sha>)`;
  try {
    const lines = readFileSync(safePath(root, m[1]), 'utf8').split('\n');
    const from = Number(m[2]);
    const to = Math.min(m[3] ? Number(m[3]) : from, from + 30);
    if (from < 1 || from > lines.length) return `(у файлі ${m[1]} лише ${lines.length} рядків)`;
    return lines.slice(from - 1, to).map((l, i) => `${from + i}\t${l}`).join('\n');
  } catch (e) {
    return `(файл недоступний: ${e instanceof Error ? e.message : String(e)})`;
  }
}

/** Масові коміти форматування, які blame пропускає (знайдено на кроці 00, context.md §3). */
export const IGNORE_REVS = ['1c265a1', 'b45871b'];

export const RESEARCH_TOOL_NAMES = [...READER_TOOL_NAMES, 'git_blame', 'git_log_search'] as const;

/** Інструменти ДОСЛІДНИКА (крок 04): усе з читача + blame і пошук по історії. Лише читання. */
export function researchTools(root: string) {
  return {
    ...readerTools(root),
    git_blame: tool({
      description: 'Хто й у якому коміті написав рядки from..to файлу: git blame -w -C з ігноруванням масового форматування. До 60 рядків. Лише читання.',
      inputSchema: z.object({ path: z.string(), from: z.number().int().min(1), to: z.number().int().min(1) }),
      execute: async ({ path, from, to }) => {
        safePath(root, path);
        const end = Math.min(to, from + 59);
        return git(root, ['blame', '-w', '-C', ...IGNORE_REVS.flatMap((r) => ['--ignore-rev', r]), '--date=short', '-L', `${from},${end}`, '--', path]);
      },
    }),
    git_log_search: tool({
      description: 'Коміти, що додали або прибрали рядок (git log -S <text>), формат «sha дата тема», до 20. Лише читання.',
      inputSchema: z.object({ text: z.string().min(2).max(120), path: z.string().default('.') }),
      execute: async ({ text, path }) => {
        safePath(root, path);
        return git(root, ['log', `-S${text}`, '-n20', '--format=%h %as %s', '--', path]);
      },
    }),
  };
}
