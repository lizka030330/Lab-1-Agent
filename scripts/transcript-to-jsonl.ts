#!/usr/bin/env tsx
/**
 * `npm run transcript` — конвертер журналів сесій агентів кодування у єдиний JSONL.
 *
 * Навіщо: кожен інструмент (Claude Code, Codex, Gemini CLI, opencode) пише
 * транскрипт по-своєму. Лабораторна вимагає ОДНОГО формату, щоб коректно
 * порівняти два інструменти між собою.
 *
 * Цільовий формат — один JSON-об'єкт на рядок:
 * {"ts":"2026-09-07T14:22:11.000Z","tool":"Edit","input":{"path":"src/api/health.ts"},
 *  "result":"ok","session":"<id>","source":"claude-code"}
 *
 * Прапорці:
 *   --in <шлях>       файл або тека з транскриптами (обов'язково)
 *   --source <назва>  claude-code | codex | gemini | opencode | auto (типово auto)
 *   --out <шлях>      вихідний файл (типово `.agent-log/<session>.jsonl`)
 *   --stats           надрукувати зведення (записи, інструменти, заблоковані дії)
 *   --help            довідка
 *
 * Без зовнішніх залежностей. Вхід читається ПОТОКОВО, рядок за рядком,
 * тому файл на кілька гігабайтів не потрапляє в пам'ять цілком.
 */

import { createReadStream, createWriteStream, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Типи
// ---------------------------------------------------------------------------

export type TranscriptSource = 'claude-code' | 'codex' | 'gemini' | 'opencode';
export type SourceOption = TranscriptSource | 'auto';

export const SOURCES: readonly TranscriptSource[] = ['claude-code', 'codex', 'gemini', 'opencode'];

/** Рядок цільового формату. */
export interface NormalisedEntry {
  /** Час у ISO 8601. */
  readonly ts: string;
  /** Назва інструмента, як її подає сам агент. */
  readonly tool: string;
  /** Аргументи виклику «як є». */
  readonly input: Record<string, unknown>;
  /** "ok" | "denied" | "error" або власний рядок інструмента. */
  readonly result: string;
  readonly session: string;
  readonly source: string;
}

/** Значення за замовчуванням для полів, яких немає у вхідному записі. */
export interface NormaliseContext {
  readonly session: string;
  /** Запасний час, якщо у записі немає власного. */
  readonly ts: string;
}

export type Adapter = (value: unknown, ctx: NormaliseContext) => NormalisedEntry | null;

// ---------------------------------------------------------------------------
// Дрібні чисті помічники
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Перший ключ зі списку, значення якого — непорожній рядок. */
export function pickString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return null;
}

/** Перший ключ зі списку, значення якого — об'єкт (або JSON-рядок з об'єктом). */
export function pickRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      return value;
    }
    // Codex і сумісні кладуть аргументи функції рядком JSON.
    if (typeof value === 'string' && value.trim().startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (isRecord(parsed)) {
          return parsed;
        }
      } catch {
        // Не JSON — просто пропускаємо цей ключ.
      }
    }
  }
  return null;
}

/**
 * Зводить час до ISO 8601.
 * Приймає рядок дати або число (секунди чи мілісекунди епохи).
 */
export function toIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Значення менше за 1e12 майже напевно у секундах.
    const millis = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return fallback;
}

/** Зводить довільне «значення результату» до "ok" / "denied" / "error" або короткого рядка. */
export function classifyResult(value: unknown): string {
  if (value === null || value === undefined) {
    return 'ok';
  }
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (normalised === '') {
      return 'ok';
    }
    if (/(deni|reject|refus|block|not[_\s-]?permitted|permission)/.test(normalised)) {
      return 'denied';
    }
    if (/(error|fail|exception|timeout|abort|cancel)/.test(normalised)) {
      return 'error';
    }
    if (/^(ok|success|succeeded|completed|done|allow(ed)?)$/.test(normalised)) {
      return 'ok';
    }
    // Невідомий рядок лишаємо як є (формат це дозволяє), але обрізаємо.
    return value.trim().slice(0, 200);
  }
  if (isRecord(value)) {
    if (value['is_error'] === true || value['isError'] === true) {
      return 'error';
    }
    const nested = pickString(value, ['status', 'result', 'outcome', 'decision']);
    if (nested !== null) {
      return classifyResult(nested);
    }
  }
  return 'ok';
}

/**
 * Безпечна назва файлу з ідентифікатора сесії.
 * Ідентифікатор приходить із вмісту транскрипта, тобто це недовірені дані:
 * без очищення `../../щось` записало б файл поза `.agent-log/`.
 */
export function sanitiseSessionId(raw: string, fallback = 'session'): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  return cleaned === '' ? fallback : cleaned.slice(0, 80);
}

export type ParseResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export function parseJsonLine(line: string): ParseResult {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// АДАПТЕРИ
//
// !!! УВАГА, ЦЕ ОЧІКУВАНА ТОЧКА ДООПРАЦЮВАННЯ !!!
// Точні схеми транскриптів у різних інструментів відрізняються і змінюються
// між версіями. Тому адаптери навмисно написані ЗАХИСНО: вони не покладаються
// на конкретну схему, а шукають поле серед кількох імовірних імен і, якщо
// структура невідома, кладуть усе, що залишилось, до `input`.
//
// Обов'язково звірте адаптер свого інструмента з РЕАЛЬНИМ транскриптом
// (Claude Code: ~/.claude/projects/**/*.jsonl, Codex: ~/.codex/sessions/**)
// і допишіть потрібні поля. Не вигадуйте полів, яких не бачили у файлі.
//
// Обмеження за домовленістю: адаптер повертає щонайбільше ОДИН запис на рядок.
// Якщо в рядку кілька блоків tool_use, беремо перший — розширення до масиву
// також лишається вправою для студента.
// ---------------------------------------------------------------------------

const TS_KEYS = ['timestamp', 'ts', 'time', 'createdAt', 'created_at', 'date', 'startedAt'] as const;
// Навмисно БЕЗ ключа `id`: у більшості транскриптів це ідентифікатор окремої
// події чи відповіді, і він потрапив би у поле `session` замість сесії.
const SESSION_KEYS = ['sessionId', 'session_id', 'sessionID', 'session', 'conversationId'] as const;
const TOOL_KEYS = ['tool', 'toolName', 'tool_name', 'function', 'functionName'] as const;
const INPUT_KEYS = [
  'input',
  'tool_input',
  'toolInput',
  'arguments',
  'args',
  'parameters',
  'params',
] as const;
const RESULT_KEYS = [
  'result',
  'status',
  'outcome',
  'decision',
  'permission',
  'toolUseResult',
  'tool_use_result',
  'response',
] as const;

/** Ключі, які є службовими, а не аргументами інструмента. */
const META_KEYS: ReadonlySet<string> = new Set([
  ...TS_KEYS,
  ...SESSION_KEYS,
  ...TOOL_KEYS,
  ...INPUT_KEYS,
  ...RESULT_KEYS,
  'type',
  'role',
  'uuid',
  'parentUuid',
  'name',
  'message',
  'payload',
  'part',
  'state',
  'event',
  'data',
  'version',
  'cwd',
  'model',
]);

interface ToolCall {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

/** Вкладені контейнери, у яких інструменти люблять ховати корисні поля. */
function collectScopes(record: Record<string, unknown>): readonly Record<string, unknown>[] {
  const scopes: Record<string, unknown>[] = [record];
  for (const key of ['payload', 'message', 'part', 'state', 'event', 'data', 'body']) {
    const nested = record[key];
    if (isRecord(nested)) {
      scopes.push(nested);
    }
  }
  return scopes;
}

function pickStringAcross(
  scopes: readonly Record<string, unknown>[],
  keys: readonly string[],
): string | null {
  for (const scope of scopes) {
    const found = pickString(scope, keys);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function pickUnknownAcross(
  scopes: readonly Record<string, unknown>[],
  keys: readonly string[],
): unknown {
  for (const scope of scopes) {
    for (const key of keys) {
      const value = scope[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
  }
  return undefined;
}

/** Усе, що не є службовим полем, вважаємо аргументами інструмента. */
function fallbackInput(record: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!META_KEYS.has(key)) {
      input[key] = value;
    }
  }
  return input;
}

/** Спільна для всіх адаптерів спроба знайти виклик інструмента «в лоб». */
function extractGenericToolCall(record: Record<string, unknown>): ToolCall | null {
  const tool = pickString(record, TOOL_KEYS);
  const input = pickRecord(record, INPUT_KEYS);
  if (tool !== null) {
    return { tool, input: input ?? fallbackInput(record) };
  }
  // Поле `name` беремо лише тоді, коли поруч є ознака саме виклику інструмента,
  // інакше можна помилково прийняти за інструмент ім'я користувача чи моделі.
  const name = pickString(record, ['name']);
  const type = pickString(record, ['type']) ?? '';
  const looksLikeCall = input !== null || /tool|function|command|call/i.test(type);
  if (name !== null && looksLikeCall) {
    return { tool: name, input: input ?? fallbackInput(record) };
  }
  return null;
}

/** Claude Code: блоки `tool_use` всередині `message.content[]`. */
function extractClaudeToolUse(record: Record<string, unknown>): ToolCall | null {
  const message = record['message'];
  const container = isRecord(message) ? message : record;
  const content = container['content'];
  if (!Array.isArray(content)) {
    return null;
  }
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block['type'] !== 'tool_use') {
      continue;
    }
    const tool = pickString(block, ['name', ...TOOL_KEYS]);
    if (tool === null) {
      continue;
    }
    const input = pickRecord(block, INPUT_KEYS);
    return { tool, input: input ?? fallbackInput(block) };
  }
  return null;
}

/** Codex і сумісні: `type: "function_call"` з аргументами рядком JSON. */
function extractCodexFunctionCall(record: Record<string, unknown>): ToolCall | null {
  const payload = record['payload'];
  const scope = isRecord(payload) ? payload : record;
  const type = pickString(scope, ['type']) ?? '';
  if (!/call|command|exec|function|tool/i.test(type) && pickString(scope, TOOL_KEYS) === null) {
    return null;
  }
  const tool = pickString(scope, [...TOOL_KEYS, 'name']) ?? (type === '' ? null : type);
  if (tool === null) {
    return null;
  }
  const input = pickRecord(scope, INPUT_KEYS);
  return { tool, input: input ?? fallbackInput(scope) };
}

/** Gemini CLI: `functionCall: { name, args }`, іноді всередині `parts[]`. */
function extractGeminiFunctionCall(record: Record<string, unknown>): ToolCall | null {
  const direct = record['functionCall'] ?? record['function_call'];
  if (isRecord(direct)) {
    const tool = pickString(direct, ['name', ...TOOL_KEYS]);
    if (tool !== null) {
      const input = pickRecord(direct, ['args', ...INPUT_KEYS]);
      return { tool, input: input ?? fallbackInput(direct) };
    }
  }
  const parts = record['parts'];
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!isRecord(part)) {
        continue;
      }
      const nested = extractGeminiFunctionCall(part);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

/** opencode: корисні поля часто лежать у `part` або `state`. */
function extractOpencodeTool(record: Record<string, unknown>): ToolCall | null {
  for (const key of ['part', 'state']) {
    const nested = record[key];
    if (!isRecord(nested)) {
      continue;
    }
    const tool = pickString(nested, [...TOOL_KEYS, 'name']) ?? pickString(record, TOOL_KEYS);
    if (tool === null) {
      continue;
    }
    // Аргументи в opencode часто лежать глибше — у `state.input`.
    const state = nested['state'];
    const input =
      pickRecord(nested, INPUT_KEYS) ??
      (isRecord(state) ? pickRecord(state, INPUT_KEYS) : null) ??
      pickRecord(record, INPUT_KEYS);
    return { tool, input: input ?? fallbackInput(nested) };
  }
  return null;
}

function buildEntry(
  value: unknown,
  ctx: NormaliseContext,
  source: TranscriptSource,
  extractors: readonly ((record: Record<string, unknown>) => ToolCall | null)[],
): NormalisedEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  let call: ToolCall | null = null;
  for (const extractor of extractors) {
    call = extractor(value);
    if (call !== null) {
      break;
    }
  }
  if (call === null) {
    call = extractGenericToolCall(value);
  }
  if (call === null) {
    // Це не виклик інструмента (текст моделі, службова подія тощо).
    return null;
  }
  const scopes = collectScopes(value);
  const ts = toIsoTimestamp(pickUnknownAcross(scopes, TS_KEYS), ctx.ts);
  const session = pickStringAcross(scopes, SESSION_KEYS) ?? ctx.session;
  const explicitError =
    value['is_error'] === true ||
    value['isError'] === true ||
    (value['error'] !== undefined && value['error'] !== null && value['error'] !== '');
  const result = explicitError ? 'error' : classifyResult(pickUnknownAcross(scopes, RESULT_KEYS));
  return { ts, tool: call.tool, input: call.input, result, session, source };
}

export const ADAPTERS: Readonly<Record<TranscriptSource, Adapter>> = {
  'claude-code': (value, ctx) => buildEntry(value, ctx, 'claude-code', [extractClaudeToolUse]),
  codex: (value, ctx) => buildEntry(value, ctx, 'codex', [extractCodexFunctionCall]),
  gemini: (value, ctx) => buildEntry(value, ctx, 'gemini', [extractGeminiFunctionCall]),
  opencode: (value, ctx) => buildEntry(value, ctx, 'opencode', [extractOpencodeTool]),
};

/** Евристика для `--source auto`. Повертає null, якщо впізнати не вдалося. */
export function detectSource(value: unknown): TranscriptSource | null {
  if (!isRecord(value)) {
    return null;
  }
  if ('sessionId' in value && ('message' in value || 'toolUseResult' in value || 'uuid' in value)) {
    return 'claude-code';
  }
  if ('payload' in value || value['type'] === 'function_call' || 'call_id' in value) {
    return 'codex';
  }
  if ('functionCall' in value || 'function_call' in value || 'parts' in value) {
    return 'gemini';
  }
  if ('sessionID' in value || 'providerID' in value || 'part' in value) {
    return 'opencode';
  }
  return null;
}

export function isSourceOption(value: string): value is SourceOption {
  return value === 'auto' || (SOURCES as readonly string[]).includes(value);
}

/** Нормалізує один розібраний запис. Невідомий формат → null (ніколи не кидає). */
export function normaliseValue(
  source: SourceOption,
  value: unknown,
  ctx: NormaliseContext,
): NormalisedEntry | null {
  if (source !== 'auto') {
    return ADAPTERS[source](value, ctx);
  }
  const detected = detectSource(value);
  if (detected !== null) {
    const entry = ADAPTERS[detected](value, ctx);
    if (entry !== null) {
      return entry;
    }
  }
  for (const candidate of SOURCES) {
    const entry = ADAPTERS[candidate](value, ctx);
    if (entry !== null) {
      return entry;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

export interface TranscriptStats {
  total: number;
  denied: number;
  errors: number;
  byTool: Record<string, number>;
  bySource: Record<string, number>;
}

export function createStats(): TranscriptStats {
  return { total: 0, denied: 0, errors: 0, byTool: {}, bySource: {} };
}

export function addEntryToStats(stats: TranscriptStats, entry: NormalisedEntry): void {
  stats.total += 1;
  stats.byTool[entry.tool] = (stats.byTool[entry.tool] ?? 0) + 1;
  stats.bySource[entry.source] = (stats.bySource[entry.source] ?? 0) + 1;
  if (entry.result === 'denied') {
    stats.denied += 1;
  } else if (entry.result === 'error') {
    stats.errors += 1;
  }
}

export function summariseEntries(entries: readonly NormalisedEntry[]): TranscriptStats {
  const stats = createStats();
  for (const entry of entries) {
    addEntryToStats(stats, entry);
  }
  return stats;
}

export function renderStats(stats: TranscriptStats): string {
  const lines: string[] = [];
  lines.push(`Записів: ${stats.total}`);
  lines.push(`Заблокованих дій (denied): ${stats.denied}`);
  lines.push(`Помилок (error): ${stats.errors}`);
  const tools = Object.entries(stats.byTool).sort((a, b) => b[1] - a[1]);
  if (tools.length > 0) {
    lines.push('За інструментами:');
    for (const [tool, count] of tools) {
      lines.push(`  ${tool}: ${count}`);
    }
  }
  const sources = Object.entries(stats.bySource).sort((a, b) => b[1] - a[1]);
  if (sources.length > 0) {
    lines.push('За джерелами:');
    for (const [source, count] of sources) {
      lines.push(`  ${source}: ${count}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Читання входу і запис результату
// ---------------------------------------------------------------------------

const INPUT_EXTENSIONS: ReadonlySet<string> = new Set(['.jsonl', '.ndjson', '.json', '.log']);

/** Збирає перелік вхідних файлів: сам файл або всі придатні файли теки. */
export function collectInputFiles(inputPath: string): readonly string[] {
  const stats = statSync(inputPath);
  if (stats.isFile()) {
    return [inputPath];
  }
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && INPUT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  };
  walk(inputPath);
  found.sort();
  return found;
}

export interface ConvertOptions {
  readonly inputPath: string;
  readonly source: SourceOption;
  readonly outPath: string;
  readonly showStats: boolean;
}

export interface ConvertResult {
  readonly outPath: string;
  readonly files: number;
  readonly entries: number;
  /** Рядки, розібрані успішно, але це не виклики інструментів. */
  readonly skipped: number;
  /** Рядки, які не вдалося розібрати як JSON. */
  readonly invalid: number;
  readonly firstInvalidSample: string | null;
  readonly stats: TranscriptStats;
}

interface Counters {
  entries: number;
  skipped: number;
  invalid: number;
  firstInvalidSample: string | null;
}

async function writeLine(stream: WriteStream, line: string): Promise<void> {
  if (!stream.write(line)) {
    // Поважаємо зворотний тиск — це зворотний бік правила «не тримати все в пам'яті».
    await once(stream, 'drain');
  }
}

/** Дістає масив записів із документа JSON (не JSONL). */
function extractArray(document: unknown): readonly unknown[] {
  if (Array.isArray(document)) {
    return document;
  }
  if (isRecord(document)) {
    for (const key of ['entries', 'events', 'messages', 'items', 'records', 'history']) {
      const value = document[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
    return [document];
  }
  return [];
}

async function processFile(
  file: string,
  options: ConvertOptions,
  ctx: NormaliseContext,
  stats: TranscriptStats,
  counters: Counters,
  sink: (entry: NormalisedEntry) => Promise<void>,
): Promise<void> {
  const handleValue = async (value: unknown): Promise<void> => {
    const entry = normaliseValue(options.source, value, ctx);
    if (entry === null) {
      counters.skipped += 1;
      return;
    }
    addEntryToStats(stats, entry);
    counters.entries += 1;
    await sink(entry);
  };

  const input = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });

  let first = true;
  let isJsonDocument = false;
  for await (const line of rl) {
    if (first) {
      first = false;
      if (line.trimStart().startsWith('[')) {
        // Це звичайний JSON, а не JSONL: рядкове читання тут не спрацює.
        isJsonDocument = true;
        rl.close();
        input.destroy();
        break;
      }
    }
    if (line.trim() === '') {
      continue;
    }
    const parsed = parseJsonLine(line);
    if (!parsed.ok) {
      counters.invalid += 1;
      if (counters.firstInvalidSample === null) {
        counters.firstInvalidSample = `${file}: ${line.trim().slice(0, 120)}`;
      }
      continue;
    }
    await handleValue(parsed.value);
  }

  if (!isJsonDocument) {
    return;
  }
  // Резервний шлях для JSON-документа: доводиться читати файл цілком.
  const size = statSync(file).size;
  if (size > 64 * 1024 * 1024) {
    process.stderr.write(
      `Попередження: ${file} — це суцільний JSON розміром ${Math.round(size / 1024 / 1024)} МБ; читаємо в пам'ять.\n`,
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    counters.invalid += 1;
    if (counters.firstInvalidSample === null) {
      counters.firstInvalidSample = `${file}: файл не є коректним JSON`;
    }
    return;
  }
  for (const value of extractArray(document)) {
    await handleValue(value);
  }
}

export async function convertTranscripts(options: ConvertOptions): Promise<ConvertResult> {
  const files = collectInputFiles(options.inputPath);
  const stats = createStats();
  const counters: Counters = { entries: 0, skipped: 0, invalid: 0, firstInvalidSample: null };

  mkdirSync(dirname(resolve(options.outPath)), { recursive: true });
  const out = createWriteStream(options.outPath, { encoding: 'utf8' });
  const sink = async (entry: NormalisedEntry): Promise<void> => {
    await writeLine(out, `${JSON.stringify(entry)}\n`);
  };

  const fallbackSession = defaultSessionId(options.inputPath);
  try {
    for (const file of files) {
      const ctx: NormaliseContext = {
        session: fallbackSession,
        ts: new Date(statSync(file).mtimeMs).toISOString(),
      };
      await processFile(file, options, ctx, stats, counters, sink);
    }
  } finally {
    out.end();
    await once(out, 'finish');
  }

  return {
    outPath: options.outPath,
    files: files.length,
    entries: counters.entries,
    skipped: counters.skipped,
    invalid: counters.invalid,
    firstInvalidSample: counters.firstInvalidSample,
    stats,
  };
}

/** Ідентифікатор сесії за замовчуванням — з імені вхідного файлу чи теки. */
export function defaultSessionId(inputPath: string): string {
  const base = basename(inputPath);
  const withoutExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return sanitiseSessionId(withoutExt === '' ? 'session' : withoutExt);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Використання: npm run transcript -- --in <шлях> [прапорці]

  --in <шлях>       файл або тека з транскриптами (обов'язково)
  --source <назва>  ${SOURCES.join(' | ')} | auto (типово auto)
  --out <шлях>      вихідний файл (типово .agent-log/<session>.jsonl)
  --stats           надрукувати зведення
  --help            ця довідка
`;

export async function runTranscriptToJsonl(argv: readonly string[]): Promise<0 | 1> {
  let options: ConvertOptions;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        in: { type: 'string' },
        source: { type: 'string' },
        out: { type: 'string' },
        stats: { type: 'boolean' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help === true) {
      process.stdout.write(USAGE);
      return 0;
    }
    const inputPath = values.in;
    if (inputPath === undefined || inputPath === '') {
      process.stderr.write(`Не задано --in.\n\n${USAGE}`);
      return 1;
    }
    const sourceRaw = values.source ?? 'auto';
    if (!isSourceOption(sourceRaw)) {
      process.stderr.write(`Невідоме джерело "${sourceRaw}". Доступні: ${SOURCES.join(', ')}, auto.\n`);
      return 1;
    }
    const outPath = values.out ?? join('.agent-log', `${defaultSessionId(inputPath)}.jsonl`);
    options = {
      inputPath,
      source: sourceRaw,
      outPath,
      showStats: values.stats === true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Помилка розбору аргументів: ${message}\n\n${USAGE}`);
    return 1;
  }

  let result: ConvertResult;
  try {
    result = await convertTranscripts(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Не вдалося конвертувати: ${message}\n`);
    return 1;
  }

  process.stdout.write(
    `Оброблено файлів: ${result.files}; записів: ${result.entries}; пропущено (не виклики інструментів): ${result.skipped}.\n`,
  );
  if (result.invalid > 0) {
    // Мовчати про нерозібрані рядки не можна — так втрачаються дані.
    process.stderr.write(
      `Попередження: не вдалося розібрати ${result.invalid} рядк(ів). Перший приклад:\n  ${result.firstInvalidSample ?? ''}\n`,
    );
  }
  if (result.entries === 0) {
    process.stderr.write(
      'Попередження: жодного виклику інструмента не розпізнано. Ймовірно, адаптер треба звірити з реальним транскриптом (див. коментар до ADAPTERS).\n',
    );
  }
  process.stdout.write(`Результат: ${resolve(result.outPath)}\n`);
  if (options.showStats) {
    process.stdout.write(`\n${renderStats(result.stats)}\n`);
  }
  return 0;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url) {
  runTranscriptToJsonl(process.argv.slice(2))
    .then((code) => {
      // process.exit() тут неприпустимий: він може обрізати буферизований вивід.
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Неочікувана помилка: ${message}\n`);
      process.exitCode = 1;
    });
}
