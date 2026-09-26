#!/usr/bin/env tsx
/**
 * `npm run doctor` — самоперевірка середовища для курсу «Агентна інженерія».
 *
 * Скрипт свідомо не має жодних зовнішніх залежностей: його запускають
 * на першому занятті ДО `npm install`, тому доступні лише вбудовані модулі Node.
 *
 * Політика кодів виходу:
 *   0 — усе гаразд або є лише попередження (курс не має падати
 *       через відсутній необов'язковий інструмент);
 *   1 — не виконано обов'язкову умову (стара версія Node або немає git).
 *
 * Прапорці:
 *   --json  друкує машинозчитуваний звіт замість таблиці (для CI).
 *   --help  коротка довідка.
 */

import { existsSync, readFileSync, statSync, statfsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

/** Мінімальна мажорна версія Node, з якою працює стартовий репозиторій. */
export const MIN_NODE_MAJOR = 22;

/** Мінімум вільного місця на диску, який ми вважаємо комфортним (у байтах). */
export const MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024;

/** Перелік агентів кодування, які курс вважає взаємозамінними. */
export const CODING_AGENTS = ['claude', 'codex', 'gemini', 'opencode', 'cursor-agent'] as const;

/** Скільки різних агентів кодування вимагає програма курсу. */
export const REQUIRED_AGENT_COUNT = 2;

export type CheckStatus = 'ok' | 'fix' | 'skip';

export interface CheckResult {
  /** Стабільний ідентифікатор для автоматичної перевірки. */
  readonly id: string;
  /** Людська назва перевірки. */
  readonly title: string;
  readonly status: CheckStatus;
  /** true — провал робить код виходу 1. */
  readonly required: boolean;
  /** Короткий опис поточного стану. */
  readonly detail: string;
  /** Що зробити, якщо статус `fix`. */
  readonly hint: string | null;
}

export interface DoctorReport {
  readonly generatedAt: string;
  readonly platform: string;
  readonly nodeVersion: string;
  readonly checks: readonly CheckResult[];
  readonly okCount: number;
  readonly fixCount: number;
  readonly skipCount: number;
  /** true — жодна обов'язкова перевірка не провалена. */
  readonly passed: boolean;
  readonly exitCode: 0 | 1;
}

// ---------------------------------------------------------------------------
// Чисті функції (їх покривають тести у tests/scripts.test.ts)
// ---------------------------------------------------------------------------

/** Витягує мажорну версію з рядка на кшталт `22.4.1` або `v24.0.0`. */
export function parseMajorVersion(version: string): number | null {
  const match = /^v?(\d+)\./.exec(version.trim()) ?? /^v?(\d+)$/.exec(version.trim());
  const raw = match?.[1];
  if (raw === undefined) {
    return null;
  }
  const major = Number.parseInt(raw, 10);
  return Number.isNaN(major) ? null : major;
}

/** Чи достатня версія Node. Нерозпізнаний рядок вважаємо непідтримуваним. */
export function isNodeVersionSupported(version: string, minMajor: number = MIN_NODE_MAJOR): boolean {
  const major = parseMajorVersion(version);
  return major !== null && major >= minMajor;
}

/** Знімає обгортку з лапок навколо значення змінної середовища. */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Розбирає вміст `.env`-файлу.
 * Повертає мапу «ім'я ключа → чи заповнене значення».
 * ЗНАЧЕННЯ НАЗОВНІ НЕ ВІДДАЄМО — лише прапорець заповненості.
 */
/**
 * Структурний тип для змінних середовища. Навмисно НЕ `NodeJS.ProcessEnv`:
 * типи Next.js доповнюють його обовʼязковим `NODE_ENV`, через що в тестах
 * неможливо передати частковий обʼєкт на кшталт `{ NO_COLOR: "1" }`.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export function parseEnvKeys(content: string): ReadonlyMap<string, boolean> {
  const result = new Map<string, boolean>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    const value = stripQuotes(withoutExport.slice(eq + 1).trim());
    result.set(key, value.length > 0);
  }
  return result;
}

export interface EnvKeyDiff {
  /** Ключі, що є в еталоні (`.env.example`), але відсутні у `.env.local`. */
  readonly missing: readonly string[];
  /** Ключі, що є лише у `.env.local` (не помилка, просто інформація). */
  readonly extra: readonly string[];
}

/** Порівнює набори ключів двох `.env`-файлів. Значення не аналізуються. */
export function diffEnvKeys(expected: Iterable<string>, actual: Iterable<string>): EnvKeyDiff {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const key of expectedSet) {
    if (!actualSet.has(key)) {
      missing.push(key);
    }
  }
  for (const key of actualSet) {
    if (!expectedSet.has(key)) {
      extra.push(key);
    }
  }
  missing.sort();
  extra.sort();
  return { missing, extra };
}

/**
 * Рахує моделі у виводі `ollama list`.
 * Перший рядок — заголовок `NAME  ID  SIZE  MODIFIED`, його відкидаємо.
 */
export function countOllamaModels(stdout: string): number {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const first = lines[0];
  const withoutHeader = first !== undefined && /^NAME(\s|$)/i.test(first) ? lines.slice(1) : lines;
  return withoutHeader.length;
}

/** Чи виконується Node усередині WSL (за вмістом `/proc/version`). */
export function detectWsl(procVersion: string | null): boolean {
  return procVersion !== null && /microsoft/i.test(procVersion);
}

/** Форматує байти у зручні для читання одиниці. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'невідомо';
  }
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} ГБ`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} МБ`;
}

/** Збирає підсумковий звіт зі списку перевірок і визначає код виходу. */
export function buildReport(
  checks: readonly CheckResult[],
  meta: { readonly platform: string; readonly nodeVersion: string; readonly generatedAt: string },
): DoctorReport {
  const okCount = checks.filter((check) => check.status === 'ok').length;
  const fixCount = checks.filter((check) => check.status === 'fix').length;
  const skipCount = checks.filter((check) => check.status === 'skip').length;
  const passed = !checks.some((check) => check.required && check.status === 'fix');
  return {
    generatedAt: meta.generatedAt,
    platform: meta.platform,
    nodeVersion: meta.nodeVersion,
    checks,
    okCount,
    fixCount,
    skipCount,
    passed,
    exitCode: passed ? 0 : 1,
  };
}

// ---------------------------------------------------------------------------
// Кольори
// ---------------------------------------------------------------------------

export interface Palette {
  readonly ok: (text: string) => string;
  readonly fix: (text: string) => string;
  readonly skip: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly bold: (text: string) => string;
}

/** Кольори вмикаємо, лише якщо вивід у термінал і NO_COLOR не заданий. */
export function shouldUseColor(env: EnvLike, isTty: boolean): boolean {
  if (env['NO_COLOR'] !== undefined) {
    return false;
  }
  if (env['FORCE_COLOR'] !== undefined) {
    return true;
  }
  return isTty;
}

export function createPalette(useColor: boolean): Palette {
  if (!useColor) {
    const plain = (text: string): string => text;
    return { ok: plain, fix: plain, skip: plain, dim: plain, bold: plain };
  }
  const esc = `${String.fromCharCode(27)}[`;
  const wrap = (code: string) => (text: string): string => `${esc}${code}m${text}${esc}0m`;
  return {
    ok: wrap('32'),
    fix: wrap('31'),
    skip: wrap('90'),
    dim: wrap('90'),
    bold: wrap('1'),
  };
}

// ---------------------------------------------------------------------------
// Пошук виконуваних файлів у PATH (без зовнішніх залежностей)
// ---------------------------------------------------------------------------

function readPathVariable(env: EnvLike): string {
  // На Windows змінна може називатися `Path`; process.env там регістронезалежний,
  // але у тестах сюди можуть передати звичайний об'єкт.
  return env['PATH'] ?? env['Path'] ?? env['path'] ?? '';
}

function pathExtensions(platform: string, env: EnvLike): readonly string[] {
  if (platform !== 'win32') {
    return [''];
  }
  const raw = env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext !== '');
}

/**
 * Аналог `which`/`where` на вбудованих модулях.
 * Повертає абсолютний шлях до виконуваного файлу або null.
 */
export function whichSync(
  command: string,
  env: EnvLike = process.env,
  platform: string = process.platform,
): string | null {
  const pathValue = readPathVariable(env);
  if (pathValue === '') {
    return null;
  }
  const extensions = pathExtensions(platform, env);
  for (const dir of pathValue.split(delimiter)) {
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (trimmed === '') {
      continue;
    }
    for (const ext of extensions) {
      const candidate = join(trimmed, command + ext);
      try {
        if (statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Недоступна тека у PATH — просто пропускаємо.
      }
    }
  }
  return null;
}

/** Чи є шлях скриптом-обгорткою Windows (їх не можна запускати без shell). */
function isWindowsShim(executable: string): boolean {
  return /\.(cmd|bat|ps1)$/i.test(executable);
}

// ---------------------------------------------------------------------------
// Самі перевірки
// ---------------------------------------------------------------------------

function ok(id: string, title: string, detail: string, required = false): CheckResult {
  return { id, title, status: 'ok', required, detail, hint: null };
}

function fix(id: string, title: string, detail: string, hint: string, required = false): CheckResult {
  return { id, title, status: 'fix', required, detail, hint };
}

function skip(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: 'skip', required: false, detail, hint: null };
}

function readTextFileSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function checkNode(nodeVersion: string): CheckResult {
  if (isNodeVersionSupported(nodeVersion)) {
    return ok('node', 'Node.js', `версія ${nodeVersion} (потрібно >= ${MIN_NODE_MAJOR})`, true);
  }
  return fix(
    'node',
    'Node.js',
    `версія ${nodeVersion} застара (потрібно >= ${MIN_NODE_MAJOR})`,
    `Встановіть Node.js ${MIN_NODE_MAJOR} LTS або новішу: https://nodejs.org (або через nvm/fnm/volta).`,
    true,
  );
}

function checkGit(): CheckResult {
  const found = whichSync('git');
  if (found !== null) {
    return ok('git', 'git', found, true);
  }
  return fix(
    'git',
    'git',
    'не знайдено в PATH',
    'Встановіть Git (https://git-scm.com/downloads) і перезапустіть термінал.',
    true,
  );
}

function checkPackageManagers(): CheckResult {
  const npm = whichSync('npm');
  const extras = (['pnpm', 'yarn'] as const).filter((name) => whichSync(name) !== null);
  const extrasText = extras.length > 0 ? `; також доступні: ${extras.join(', ')}` : '';
  if (npm !== null) {
    return ok('package-manager', 'Менеджер пакетів', `npm знайдено${extrasText}`);
  }
  return fix(
    'package-manager',
    'Менеджер пакетів',
    `npm не знайдено в PATH${extrasText}`,
    'npm постачається разом із Node.js — перевстановіть Node або додайте його до PATH.',
  );
}

function checkCodingAgents(): CheckResult {
  const found = CODING_AGENTS.filter((name) => whichSync(name) !== null);
  const detail = found.length > 0 ? `знайдено: ${found.join(', ')}` : 'не знайдено жодного';
  if (found.length >= REQUIRED_AGENT_COUNT) {
    return ok('coding-agents', 'Агенти кодування', detail);
  }
  return fix(
    'coding-agents',
    'Агенти кодування',
    `${detail} (потрібно щонайменше ${REQUIRED_AGENT_COUNT})`,
    `Лабораторні порівнюють два інструменти між собою, тому встановіть щонайменше ${REQUIRED_AGENT_COUNT} з переліку: ${CODING_AGENTS.join(', ')}.`,
  );
}

function checkOllama(): CheckResult {
  const executable = whichSync('ollama');
  if (executable === null) {
    return fix(
      'ollama',
      'ollama',
      'не знайдено в PATH',
      'Потрібен для теми про локальні моделі: https://ollama.com/download',
    );
  }
  if (isWindowsShim(executable)) {
    // .cmd/.bat не запускаємо напряму: сучасний Node відмовляє без shell,
    // а вмикати shell заради переліку моделей не варто.
    return ok('ollama', 'ollama', `${executable} (перелік моделей не перевіряли)`);
  }
  const run = spawnSync(executable, ['list'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (run.error !== undefined || run.status !== 0 || typeof run.stdout !== 'string') {
    return ok('ollama', 'ollama', `${executable} (не вдалося отримати перелік моделей)`);
  }
  const models = countOllamaModels(run.stdout);
  return ok('ollama', 'ollama', `${executable}; моделей: ${models}`);
}

function checkDocker(): CheckResult {
  const found = whichSync('docker');
  if (found !== null) {
    return ok('docker', 'docker', found);
  }
  return skip('docker', 'docker', 'не знайдено; потрібен лише для окремих тем');
}

function checkPlatform(platform: string): CheckResult {
  if (platform !== 'win32') {
    const isWsl = detectWsl(readTextFileSafe('/proc/version'));
    return ok('platform', 'Платформа', isWsl ? `${platform} (WSL)` : platform);
  }
  const isWsl = detectWsl(readTextFileSafe('/proc/version'));
  if (isWsl) {
    return ok('platform', 'Платформа', 'Windows + WSL');
  }
  return fix(
    'platform',
    'Платформа',
    'Windows без WSL',
    'Частина інструментів (зокрема окремі агенти кодування та скрипти на shell) працює на Windows обмежено. Рекомендуємо WSL2: https://learn.microsoft.com/windows/wsl/install',
  );
}

function checkEnvFile(projectRoot: string): CheckResult {
  const localPath = join(projectRoot, '.env.local');
  const examplePath = join(projectRoot, '.env.example');
  const localContent = readTextFileSafe(localPath);
  if (localContent === null) {
    const hint = existsSync(examplePath)
      ? 'Скопіюйте `.env.example` у `.env.local` і заповніть ключі (файл не потрапляє до git).'
      : 'Створіть `.env.local` з ключами API (файл не потрапляє до git).';
    return fix('env-local', '.env.local', 'файл відсутній', hint);
  }
  const localKeys = parseEnvKeys(localContent);
  const filled = [...localKeys.values()].filter(Boolean).length;
  const exampleContent = readTextFileSafe(examplePath);
  if (exampleContent === null) {
    return filled > 0
      ? ok('env-local', '.env.local', `ключів: ${localKeys.size}, заповнено: ${filled}`)
      : fix(
          'env-local',
          '.env.local',
          `ключів: ${localKeys.size}, жоден не заповнено`,
          'Впишіть значення принаймні одного ключа API.',
        );
  }
  const exampleKeys = parseEnvKeys(exampleContent);
  const { missing } = diffEnvKeys(exampleKeys.keys(), localKeys.keys());
  // Навмисно друкуємо лише ІМЕНА ключів — значення ніколи не виводимо.
  const detail = `ключів: ${localKeys.size}, заповнено: ${filled}${
    missing.length > 0 ? `; бракує: ${missing.join(', ')}` : ''
  }`;
  if (filled === 0) {
    return fix(
      'env-local',
      '.env.local',
      detail,
      'Впишіть значення принаймні одного ключа API у `.env.local`.',
    );
  }
  if (missing.length > 0) {
    return fix(
      'env-local',
      '.env.local',
      detail,
      `Додайте до \`.env.local\` ключі з \`.env.example\`: ${missing.join(', ')}.`,
    );
  }
  return ok('env-local', '.env.local', detail);
}

function checkNodeModules(projectRoot: string): CheckResult {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return ok('node-modules', 'Залежності', 'node_modules на місці');
  }
  return fix('node-modules', 'Залежності', 'node_modules відсутні', 'Виконайте `npm install`.');
}

function checkDiskSpace(projectRoot: string): CheckResult {
  try {
    const stats = statfsSync(projectRoot);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(free) || free <= 0) {
      return skip('disk', 'Вільне місце', 'не вдалося визначити');
    }
    if (free >= MIN_FREE_BYTES) {
      return ok('disk', 'Вільне місце', `${formatBytes(free)} (потрібно >= ${formatBytes(MIN_FREE_BYTES)})`);
    }
    return fix(
      'disk',
      'Вільне місце',
      `${formatBytes(free)} (потрібно >= ${formatBytes(MIN_FREE_BYTES)})`,
      'Звільніть місце на диску: моделі, образи Docker і node_modules швидко його з’їдають.',
    );
  } catch {
    // На деяких файлових системах statfs недоступний — це не помилка курсу.
    return skip('disk', 'Вільне місце', 'вбудованими засобами визначити не вдалося');
  }
}

/** Виконує всі перевірки. Єдина функція, що звертається до системи. */
export function runChecks(projectRoot: string = process.cwd()): readonly CheckResult[] {
  return [
    checkNode(process.versions.node),
    checkGit(),
    checkPackageManagers(),
    checkCodingAgents(),
    checkOllama(),
    checkDocker(),
    checkPlatform(process.platform),
    checkEnvFile(projectRoot),
    checkNodeModules(projectRoot),
    checkDiskSpace(projectRoot),
  ];
}

// ---------------------------------------------------------------------------
// Вивід
// ---------------------------------------------------------------------------

const BADGE: Readonly<Record<CheckStatus, string>> = {
  ok: '[ OK ]',
  fix: '[ FIX ]',
  skip: '[ -- ]',
};

export function formatCheckLine(check: CheckResult, palette: Palette): string {
  const paint = check.status === 'ok' ? palette.ok : check.status === 'fix' ? palette.fix : palette.skip;
  const badge = paint(BADGE[check.status].padEnd(7));
  const required = check.required ? palette.dim(' (обов’язково)') : '';
  return `${badge} ${check.title}${required} — ${check.detail}`;
}

export function renderReport(report: DoctorReport, palette: Palette): string {
  const lines: string[] = [];
  lines.push(palette.bold('Перевірка середовища курсу «Агентна інженерія»'));
  lines.push('');
  for (const check of report.checks) {
    lines.push(formatCheckLine(check, palette));
  }
  lines.push('');
  lines.push(
    `Підсумок: ${report.okCount} OK, ${report.fixCount} FIX, ${report.skipCount} пропущено.`,
  );
  const todo = report.checks.filter((check) => check.status === 'fix');
  if (todo.length > 0) {
    lines.push('');
    lines.push(palette.bold('Що зробити:'));
    for (const check of todo) {
      const mark = check.required ? palette.fix('!') : '-';
      lines.push(`  ${mark} ${check.title}: ${check.hint ?? check.detail}`);
    }
  }
  lines.push('');
  lines.push(
    report.passed
      ? palette.ok('Обов’язкові умови виконано — можна працювати.')
      : palette.fix('Обов’язкові умови не виконано. Виправте пункти з «!» вище.'),
  );
  return lines.join('\n');
}

const USAGE = `Використання: npm run doctor [-- --json]

  --json   друкує JSON-звіт замість таблиці
  --help   ця довідка
`;

/** Точка входу CLI. Повертає код виходу, але сама його не встановлює. */
export function runDoctor(argv: readonly string[], projectRoot: string = process.cwd()): 0 | 1 {
  // Навмисно без parseArgs: перевірка версії Node має надрукуватися
  // навіть на дуже старому Node, де імпорт node:util міг би повестися інакше.
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  const asJson = argv.includes('--json');
  const checks = runChecks(projectRoot);
  const report = buildReport(checks, {
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.versions.node,
    generatedAt: new Date().toISOString(),
  });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exitCode;
  }
  const palette = createPalette(shouldUseColor(process.env, process.stdout.isTTY === true));
  process.stdout.write(`${renderReport(report, palette)}\n`);
  return report.exitCode;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  process.exitCode = runDoctor(process.argv.slice(2));
}
