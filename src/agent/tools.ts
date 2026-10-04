/**
 * Інструменти власного агентного циклу (крок 08).
 * Лише читання і лише в межах репозиторію. Запис із підтвердженням — крок 09.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export type ToolOutcome = 'ok' | 'error' | 'denied';

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema аргументів для API (з additionalProperties: false). */
  readonly jsonSchema: Record<string, unknown>;
  /** Перевіряє аргументи строгою схемою zod і виконує інструмент. Не кидає винятків. */
  run(input: unknown): Promise<{ readonly outcome: ToolOutcome; readonly content: string }>;
}

/** Рядок журналу — той самий 6-польовий формат, що й у hooks. */
export interface LogEntry {
  readonly ts: string;
  readonly tool: string;
  readonly input: unknown;
  readonly result: ToolOutcome;
  readonly session: string;
  readonly source: 'agent-loop';
}

class DeniedError extends Error {}

const MAX_CHARS = 20_000;
const HIDDEN = new Set(['node_modules', '.git', '.next']);

/** Абсолютний шлях усередині root. Вихід за межі репозиторію або .env* — відмова. */
export function resolveInside(root: string, relative: string): string {
  const abs = path.resolve(root, relative);
  const rel = path.relative(root, abs);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new DeniedError(`шлях поза репозиторієм: ${relative}`);
  }
  const base = path.basename(abs).toLowerCase();
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
    throw new DeniedError(`секрети агент не читає: ${relative}`);
  }
  return abs;
}

function defineTool<S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  execute: (args: z.output<S>) => Promise<string>,
): AgentTool {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema) };
  delete jsonSchema.$schema; // службове поле; API інструментів його не потребують
  return {
    name,
    description,
    jsonSchema,
    async run(input) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return { outcome: 'error', content: `Невалідні аргументи ${name}:\n${z.prettifyError(parsed.error)}` };
      }
      try {
        return { outcome: 'ok', content: await execute(parsed.data) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { outcome: error instanceof DeniedError ? 'denied' : 'error', content: message };
      }
    },
  };
}

const PathArgs = z
  .object({ path: z.string().min(1).describe('відносний шлях від кореня репозиторію') })
  .strict();

export function createTools(root: string): readonly AgentTool[] {
  return [
    defineTool(
      'list_files',
      'Показати файли й теки за відносним шляхом ("." — корінь). Теки мають "/" у кінці.',
      PathArgs,
      async (args) => {
        const entries = await readdir(resolveInside(root, args.path), { withFileTypes: true });
        return entries
          .filter((entry) => !HIDDEN.has(entry.name))
          .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
          .sort()
          .join('\n');
      },
    ),
    defineTool('read_file', 'Прочитати текстовий файл за відносним шляхом.', PathArgs, async (args) => {
      const text = await readFile(resolveInside(root, args.path), 'utf8');
      return text.length <= MAX_CHARS
        ? text
        : `${text.slice(0, MAX_CHARS)}\n… обрізано, у файлі ${text.length} символів`;
    }),
  ];
}

/** Дописує рядки в .agent-log/*.jsonl. У `input` лише аргументи виклику (шляхи), не вміст файлів. */
export function jsonlLogger(file: string): (entry: LogEntry) => void {
  return (entry) => {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  };
}