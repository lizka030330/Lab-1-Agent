#!/usr/bin/env tsx
/**
 * `npm run sync-skills` — синхронізація навичок між агентами кодування.
 *
 * Навіщо: Claude Code читає навички з `.claude/skills/`, а Codex і сумісні
 * інструменти — з `.agents/skills/`. Щоб той самий `SKILL.md` бачили обидва,
 * ми тримаємо ОДНЕ джерело і копіюємо його у другу теку.
 *
 * Прапорці:
 *   --from <шлях>  джерело (за замовчуванням `.claude/skills`)
 *   --to <шлях>    ціль (за замовчуванням `.agents/skills`)
 *   --check        нічого не пише; код виходу 1, якщо синхронізація потрібна (для CI)
 *   --dry-run      показує, що було б зроблено
 *   --force        перезаписує навіть тоді, коли файл у цілі новіший за джерело
 *   --help         довідка
 *
 * Без зовнішніх залежностей — лише вбудовані модулі Node.
 */

import { copyFileSync, mkdirSync, readdirSync, statSync, utimesSync, type Dirent } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export const DEFAULT_FROM = join('.claude', 'skills');
export const DEFAULT_TO = join('.agents', 'skills');

/**
 * Допуск при порівнянні часу зміни файлів.
 * Потрібен, бо різні файлові системи (FAT/exFAT, мережеві диски, OneDrive)
 * зберігають mtime з різною точністю, і після копіювання час може «поїхати».
 */
export const DEFAULT_MTIME_TOLERANCE_MS = 2000;

/** Теки й файли, які ніколи не синхронізуємо. */
export const IGNORED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.DS_Store',
  'Thumbs.db',
]);

/** Приховані файли, які все ж потрібні (щоб порожні теки лишалися в git). */
export const ALLOWED_HIDDEN_NAMES: ReadonlySet<string> = new Set(['.gitkeep', '.keep']);

// ---------------------------------------------------------------------------
// Чисті функції
// ---------------------------------------------------------------------------

/** Чи слід ігнорувати запис під час обходу (перевіряється для вкладених імен). */
export function shouldIgnoreEntry(name: string): boolean {
  if (IGNORED_NAMES.has(name)) {
    return true;
  }
  if (name.startsWith('.')) {
    return !ALLOWED_HIDDEN_NAMES.has(name);
  }
  return false;
}

export type SyncAction = 'copy' | 'skip' | 'conflict';

export interface CopyDecisionInput {
  readonly sourceMtimeMs: number;
  readonly sourceSize: number;
  readonly targetExists: boolean;
  /** null, якщо цілі немає або час невідомий. */
  readonly targetMtimeMs: number | null;
  readonly targetSize: number | null;
  readonly force: boolean;
  /** Допуск порівняння часу; за замовчуванням DEFAULT_MTIME_TOLERANCE_MS. */
  readonly toleranceMs?: number;
}

export interface CopyDecision {
  readonly action: SyncAction;
  /** Пояснення українською — його друкує CLI. */
  readonly reason: string;
}

/**
 * Вирішує долю одного файлу. Чиста функція: не звертається до диска,
 * приймає лише факти про час і розмір — тому легко тестується.
 *
 * `conflict` означає «ціль новіша за джерело» — мовчки перезаписувати
 * чужу правку не можна, потрібен явний `--force`.
 */
export function decideCopy(input: CopyDecisionInput): CopyDecision {
  const tolerance = input.toleranceMs ?? DEFAULT_MTIME_TOLERANCE_MS;

  if (!input.targetExists) {
    return { action: 'copy', reason: 'у цілі файлу немає' };
  }
  if (input.force) {
    return { action: 'copy', reason: 'примусове перезаписування (--force)' };
  }
  if (input.targetMtimeMs === null) {
    return { action: 'copy', reason: 'не вдалося визначити час зміни цілі' };
  }

  const delta = input.sourceMtimeMs - input.targetMtimeMs;
  const sameSize = input.targetSize !== null && input.targetSize === input.sourceSize;

  if (Math.abs(delta) <= tolerance) {
    return sameSize
      ? { action: 'skip', reason: 'уже синхронізовано' }
      : { action: 'copy', reason: 'однаковий час зміни, але різний розмір' };
  }
  if (delta > 0) {
    return { action: 'copy', reason: 'джерело новіше' };
  }
  return {
    action: 'conflict',
    reason: 'ціль новіша за джерело — правку зроблено не в джерелі',
  };
}

export interface SyncItem {
  /** Шлях відносно кореня джерела, у POSIX-стилі. */
  readonly relativePath: string;
  readonly action: SyncAction;
  readonly reason: string;
}

export interface SyncSummary {
  readonly from: string;
  readonly to: string;
  readonly skills: number;
  readonly copied: number;
  readonly skipped: number;
  readonly conflicts: number;
  /** Скільки файлів ще треба перенести (для `--check` і `--dry-run`). */
  readonly pending: number;
  readonly items: readonly SyncItem[];
}

/** Нормалізує роздільники шляху, щоб вивід був однаковий на Windows і Linux. */
export function toPosixPath(value: string): string {
  return value.split(sep).join('/');
}

// ---------------------------------------------------------------------------
// Робота з диском
// ---------------------------------------------------------------------------

/**
 * Рекурсивно збирає відносні шляхи всіх файлів під `root`,
 * пропускаючи ігноровані імена. Порядок стабільний (відсортований).
 */
export function collectFiles(root: string): readonly string[] {
  const result: string[] = [];
  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Фільтруємо саме вкладені імена, а не корінь:
      // корінь `.claude/skills` сам починається з крапки.
      if (shouldIgnoreEntry(entry.name)) {
        continue;
      }
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        result.push(toPosixPath(relative(root, full)));
      }
    }
  };
  walk(root);
  result.sort();
  return result;
}

/** Рахує навички — теки першого рівня в джерелі. */
export function countSkills(root: string): number {
  try {
    return readdirSync(root, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && !shouldIgnoreEntry(entry.name),
    ).length;
  } catch {
    return 0;
  }
}

interface FileFacts {
  readonly exists: boolean;
  readonly mtimeMs: number | null;
  readonly size: number | null;
}

function readFacts(path: string): FileFacts {
  try {
    const stats = statSync(path);
    return { exists: true, mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return { exists: false, mtimeMs: null, size: null };
  }
}

/**
 * Копіює файл і ПЕРЕНОСИТЬ час зміни з джерела.
 * Без utimes ціль щоразу виглядала б новішою за джерело,
 * і наступний запуск повідомляв би про неіснуючий конфлікт.
 */
function copyPreservingMtime(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  const stats = statSync(source);
  try {
    utimesSync(target, stats.atime, stats.mtime);
  } catch {
    // Якщо ФС не дозволяє змінити час — не критично, наступний запуск
    // просто побачить «однаковий розмір, інший час».
  }
}

export interface SyncOptions {
  readonly from: string;
  readonly to: string;
  readonly force: boolean;
  readonly check: boolean;
  readonly dryRun: boolean;
  readonly toleranceMs?: number;
}

/** Основна логіка синхронізації. Пише на диск лише якщо не `check`/`dryRun`. */
export function syncSkills(options: SyncOptions): SyncSummary {
  const from = resolve(options.from);
  const to = resolve(options.to);
  // Синхронізуємо лише вміст тек навичок. Файли в корені `.claude/skills/`
  // (наприклад README цієї теки) — документація для людини, а не навичка:
  // копіювати їх у `.agents/skills/` не треба.
  const files = collectFiles(from).filter((rel) => rel.includes('/'));
  const items: SyncItem[] = [];
  let copied = 0;
  let skipped = 0;
  let conflicts = 0;
  let pending = 0;
  const writeAllowed = !options.check && !options.dryRun;

  for (const relativePath of files) {
    const sourcePath = join(from, relativePath);
    const targetPath = join(to, relativePath);
    const sourceFacts = readFacts(sourcePath);
    const targetFacts = readFacts(targetPath);
    if (sourceFacts.mtimeMs === null || sourceFacts.size === null) {
      continue;
    }
    const decision = decideCopy({
      sourceMtimeMs: sourceFacts.mtimeMs,
      sourceSize: sourceFacts.size,
      targetExists: targetFacts.exists,
      targetMtimeMs: targetFacts.mtimeMs,
      targetSize: targetFacts.size,
      force: options.force,
      ...(options.toleranceMs !== undefined ? { toleranceMs: options.toleranceMs } : {}),
    });
    items.push({ relativePath, action: decision.action, reason: decision.reason });

    switch (decision.action) {
      case 'copy':
        pending += 1;
        if (writeAllowed) {
          copyPreservingMtime(sourcePath, targetPath);
          copied += 1;
        }
        break;
      case 'conflict':
        conflicts += 1;
        pending += 1;
        break;
      case 'skip':
        skipped += 1;
        break;
    }
  }

  return {
    from,
    to,
    skills: countSkills(from),
    copied,
    skipped,
    conflicts,
    pending,
    items,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Використання: npm run sync-skills [-- прапорці]

  --from <шлях>  джерело (за замовчуванням ${DEFAULT_FROM})
  --to <шлях>    ціль (за замовчуванням ${DEFAULT_TO})
  --check        нічого не пише; код 1, якщо потрібна синхронізація (CI)
  --dry-run      показує, що було б зроблено
  --force        перезаписує файли, новіші за джерело
  --help         ця довідка
`;

export function renderSummary(summary: SyncSummary, options: SyncOptions): string {
  const lines: string[] = [];
  lines.push(`Джерело: ${summary.from}`);
  lines.push(`Ціль:    ${summary.to}`);
  lines.push('');
  for (const item of summary.items) {
    if (item.action === 'skip') {
      continue;
    }
    const mark =
      item.action === 'conflict' ? 'КОНФЛІКТ' : options.check || options.dryRun ? 'треба' : 'копіюю';
    lines.push(`  ${mark}: ${item.relativePath} — ${item.reason}`);
  }
  if (summary.items.every((item) => item.action === 'skip')) {
    lines.push('  усе вже синхронізовано');
  }
  lines.push('');
  lines.push(
    `Навичок: ${summary.skills}; скопійовано: ${summary.copied}; пропущено: ${summary.skipped}; конфліктів: ${summary.conflicts}.`,
  );
  if (summary.conflicts > 0) {
    lines.push(
      'Файли в цілі новіші за джерело. Перенесіть правку до джерела або запустіть з --force.',
    );
  }
  if (options.check && summary.pending > 0) {
    lines.push('Потрібна синхронізація: виконайте `npm run sync-skills`.');
  }
  return lines.join('\n');
}

export function runSyncSkills(argv: readonly string[]): 0 | 1 {
  let options: SyncOptions;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        from: { type: 'string' },
        to: { type: 'string' },
        check: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        force: { type: 'boolean' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help === true) {
      process.stdout.write(USAGE);
      return 0;
    }
    options = {
      from: values.from ?? DEFAULT_FROM,
      to: values.to ?? DEFAULT_TO,
      check: values.check === true,
      dryRun: values['dry-run'] === true,
      force: values.force === true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Помилка розбору аргументів: ${message}\n\n${USAGE}`);
    return 1;
  }

  const summary = syncSkills(options);
  process.stdout.write(`${renderSummary(summary, options)}\n`);

  if (options.check) {
    return summary.pending > 0 ? 1 : 0;
  }
  // Конфлікти не валять збірку, але їх видно у виводі.
  return 0;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  process.exitCode = runSyncSkills(process.argv.slice(2));
}
