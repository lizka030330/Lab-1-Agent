/**
 * Тести службових скриптів курсу.
 *
 * Покриваємо саме ЧИСТІ функції, а не CLI: так тести лишаються швидкими
 * і не залежать від встановлених інструментів на машині студента.
 * Там, де без файлової системи не обійтися, працюємо у тимчасовій теці
 * (`os.tmpdir()`) і прибираємо за собою.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildReport,
  countOllamaModels,
  detectWsl,
  diffEnvKeys,
  isNodeVersionSupported,
  parseEnvKeys,
  parseMajorVersion,
  shouldUseColor,
  type CheckResult,
} from '../scripts/doctor';

import {
  collectFiles,
  decideCopy,
  shouldIgnoreEntry,
  syncSkills,
} from '../scripts/sync-skills';

import {
  ADAPTERS,
  classifyResult,
  detectSource,
  normaliseValue,
  parseJsonLine,
  sanitiseSessionId,
  summariseEntries,
  toIsoTimestamp,
  SOURCES,
  type NormaliseContext,
  type NormalisedEntry,
} from '../scripts/transcript-to-jsonl';

// ---------------------------------------------------------------------------
// Тимчасові теки
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

describe('doctor: версія Node', () => {
  it('приймає версії від 22 і вище', () => {
    expect(isNodeVersionSupported('22.0.0')).toBe(true);
    expect(isNodeVersionSupported('24.5.1')).toBe(true);
    expect(isNodeVersionSupported('v24.0.0')).toBe(true);
  });

  it('відхиляє старіші версії', () => {
    expect(isNodeVersionSupported('20.19.0')).toBe(false);
    expect(isNodeVersionSupported('v18.20.4')).toBe(false);
  });

  it('нерозпізнаний рядок вважає непідтримуваним', () => {
    expect(isNodeVersionSupported('')).toBe(false);
    expect(isNodeVersionSupported('не версія')).toBe(false);
    expect(parseMajorVersion('казна-що')).toBeNull();
  });

  it('поважає власний поріг', () => {
    expect(isNodeVersionSupported('20.0.0', 20)).toBe(true);
    expect(isNodeVersionSupported('20.0.0', 24)).toBe(false);
  });
});

describe('doctor: ключі .env', () => {
  const example = [
    '# Ключі для лабораторних',
    'ANTHROPIC_API_KEY=',
    'OPENAI_API_KEY=',
    'export GEMINI_API_KEY=',
    '',
    'НЕ_КЛЮЧ',
  ].join('\n');

  const local = ['ANTHROPIC_API_KEY="sk-test"', 'OPENAI_API_KEY=', 'LOCAL_ONLY=1'].join('\n');

  it('розбирає імена ключів і факт заповнення', () => {
    const keys = parseEnvKeys(local);
    expect([...keys.keys()].sort()).toEqual(['ANTHROPIC_API_KEY', 'LOCAL_ONLY', 'OPENAI_API_KEY']);
    expect(keys.get('ANTHROPIC_API_KEY')).toBe(true);
    expect(keys.get('OPENAI_API_KEY')).toBe(false);
  });

  it('ігнорує коментарі й некоректні рядки, розуміє export', () => {
    const keys = parseEnvKeys(example);
    expect(keys.has('GEMINI_API_KEY')).toBe(true);
    expect(keys.has('НЕ_КЛЮЧ')).toBe(false);
    expect(keys.size).toBe(3);
  });

  it('показує, яких ключів бракує у .env.local', () => {
    const diff = diffEnvKeys(parseEnvKeys(example).keys(), parseEnvKeys(local).keys());
    expect(diff.missing).toEqual(['GEMINI_API_KEY']);
    expect(diff.extra).toEqual(['LOCAL_ONLY']);
  });

  it('однакові набори ключів не дають розбіжностей', () => {
    const diff = diffEnvKeys(['A', 'B'], ['B', 'A']);
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
  });
});

describe('doctor: інші чисті функції', () => {
  it('рахує моделі ollama без рядка заголовка', () => {
    const stdout = [
      'NAME              ID            SIZE      MODIFIED',
      'llama3.2:3b       abc123        2.0 GB    2 days ago',
      'qwen2.5-coder:7b  def456        4.7 GB    1 week ago',
    ].join('\n');
    expect(countOllamaModels(stdout)).toBe(2);
    expect(countOllamaModels('')).toBe(0);
  });

  it('розпізнає WSL за /proc/version', () => {
    expect(detectWsl('Linux version 5.15.0-microsoft-standard-WSL2')).toBe(true);
    expect(detectWsl('Linux version 6.8.0-generic')).toBe(false);
    expect(detectWsl(null)).toBe(false);
  });

  it('вимикає кольори за NO_COLOR навіть у терміналі', () => {
    expect(shouldUseColor({ NO_COLOR: '1' }, true)).toBe(false);
    expect(shouldUseColor({}, true)).toBe(true);
    expect(shouldUseColor({}, false)).toBe(false);
  });
});

describe('doctor: код виходу', () => {
  const meta = { platform: 'linux x64', nodeVersion: '24.0.0', generatedAt: '2026-09-07T00:00:00.000Z' };

  const optionalFix: CheckResult = {
    id: 'docker',
    title: 'docker',
    status: 'fix',
    required: false,
    detail: 'немає',
    hint: 'встановіть',
  };

  const requiredFix: CheckResult = { ...optionalFix, id: 'git', title: 'git', required: true };
  const good: CheckResult = {
    id: 'node',
    title: 'Node.js',
    status: 'ok',
    required: true,
    detail: '24.0.0',
    hint: null,
  };

  it('необов’язковий провал не валить перевірку', () => {
    const report = buildReport([good, optionalFix], meta);
    expect(report.exitCode).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.fixCount).toBe(1);
  });

  it('обов’язковий провал дає код 1', () => {
    const report = buildReport([good, requiredFix], meta);
    expect(report.exitCode).toBe(1);
    expect(report.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sync-skills
// ---------------------------------------------------------------------------

describe('sync-skills: рішення про копіювання', () => {
  const base = { sourceMtimeMs: 1_000_000, sourceSize: 100, force: false, toleranceMs: 2000 };

  it('копіює те, чого немає в цілі', () => {
    const decision = decideCopy({ ...base, targetExists: false, targetMtimeMs: null, targetSize: null });
    expect(decision.action).toBe('copy');
  });

  it('пропускає однакові файли (з допуском на точність mtime)', () => {
    const decision = decideCopy({
      ...base,
      targetExists: true,
      targetMtimeMs: 1_000_500,
      targetSize: 100,
    });
    expect(decision.action).toBe('skip');
  });

  it('копіює, якщо джерело новіше', () => {
    const decision = decideCopy({
      ...base,
      targetExists: true,
      targetMtimeMs: 900_000,
      targetSize: 100,
    });
    expect(decision.action).toBe('copy');
  });

  it('не перезаписує новіший файл у цілі без --force', () => {
    const decision = decideCopy({
      ...base,
      targetExists: true,
      targetMtimeMs: 2_000_000,
      targetSize: 100,
    });
    expect(decision.action).toBe('conflict');
  });

  it('--force перезаписує навіть новіший файл', () => {
    const decision = decideCopy({
      ...base,
      force: true,
      targetExists: true,
      targetMtimeMs: 2_000_000,
      targetSize: 100,
    });
    expect(decision.action).toBe('copy');
  });

  it('однаковий час, але різний розмір — копіюємо', () => {
    const decision = decideCopy({
      ...base,
      targetExists: true,
      targetMtimeMs: 1_000_000,
      targetSize: 42,
    });
    expect(decision.action).toBe('copy');
  });
});

describe('sync-skills: фільтр файлів', () => {
  it('ігнорує службові теки й приховані файли', () => {
    expect(shouldIgnoreEntry('node_modules')).toBe(true);
    expect(shouldIgnoreEntry('.git')).toBe(true);
    expect(shouldIgnoreEntry('.DS_Store')).toBe(true);
    expect(shouldIgnoreEntry('.env.local')).toBe(true);
  });

  it('не чіпає потрібні файли', () => {
    expect(shouldIgnoreEntry('SKILL.md')).toBe(false);
    expect(shouldIgnoreEntry('references')).toBe(false);
    expect(shouldIgnoreEntry('.gitkeep')).toBe(false);
  });
});

describe('sync-skills: робота з диском', () => {
  it('обходить теку навичок і пропускає ігноровані', () => {
    const root = makeTempDir('skills-collect-');
    mkdirSync(join(root, 'code-review', 'references'), { recursive: true });
    mkdirSync(join(root, 'code-review', 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'code-review', 'SKILL.md'), '# Навичка\n', 'utf8');
    writeFileSync(join(root, 'code-review', 'references', 'checklist.md'), 'x\n', 'utf8');
    writeFileSync(join(root, 'code-review', 'node_modules', 'junk.md'), 'x\n', 'utf8');
    writeFileSync(join(root, 'code-review', '.DS_Store'), 'x', 'utf8');

    expect(collectFiles(root)).toEqual([
      'code-review/SKILL.md',
      'code-review/references/checklist.md',
    ]);
  });

  it('після синхронізації повторний запуск нічого не копіює', () => {
    const root = makeTempDir('skills-sync-');
    const from = join(root, 'source');
    const to = join(root, 'target');
    mkdirSync(join(from, 'plan-first'), { recursive: true });
    writeFileSync(join(from, 'plan-first', 'SKILL.md'), '# Спершу план\n', 'utf8');

    const first = syncSkills({ from, to, force: false, check: false, dryRun: false });
    expect(first.copied).toBe(1);
    expect(first.skills).toBe(1);
    expect(statSync(join(to, 'plan-first', 'SKILL.md')).isFile()).toBe(true);

    // Час зміни переноситься разом із файлом, інакше другий запуск
    // вважав би ціль новішою і повідомляв про фальшивий конфлікт.
    const second = syncSkills({ from, to, force: false, check: false, dryRun: false });
    expect(second.copied).toBe(0);
    expect(second.conflicts).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('--check і --dry-run нічого не пишуть', () => {
    const root = makeTempDir('skills-check-');
    const from = join(root, 'source');
    const to = join(root, 'target');
    mkdirSync(join(from, 'skill-a'), { recursive: true });
    writeFileSync(join(from, 'skill-a', 'SKILL.md'), '# A\n', 'utf8');

    const checked = syncSkills({ from, to, force: false, check: true, dryRun: false });
    expect(checked.pending).toBe(1);
    expect(checked.copied).toBe(0);
    expect(() => statSync(join(to, 'skill-a', 'SKILL.md'))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// transcript-to-jsonl
// ---------------------------------------------------------------------------

const ctx: NormaliseContext = {
  session: 'lab-01',
  ts: '2026-09-07T00:00:00.000Z',
};

describe('transcript: адаптери', () => {
  it('має адаптер для кожного відомого джерела', () => {
    for (const source of SOURCES) {
      expect(typeof ADAPTERS[source]).toBe('function');
    }
  });

  it('claude-code: витягує блок tool_use з message.content', () => {
    const line = {
      type: 'assistant',
      uuid: 'e1',
      sessionId: 'abc-123',
      timestamp: '2026-09-07T14:22:11.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Правлю файл' },
          { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { path: 'src/api/health.ts' } },
        ],
      },
    };
    expect(ADAPTERS['claude-code'](line, ctx)).toEqual({
      ts: '2026-09-07T14:22:11.000Z',
      tool: 'Edit',
      input: { path: 'src/api/health.ts' },
      result: 'ok',
      session: 'abc-123',
      source: 'claude-code',
    });
  });

  it('codex: розбирає arguments, подані рядком JSON', () => {
    const line = {
      timestamp: '2026-09-07T14:25:00.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell',
        arguments: '{"command":["ls","-la"]}',
        call_id: 'call_1',
      },
    };
    const entry = ADAPTERS.codex(line, ctx);
    expect(entry).not.toBeNull();
    expect(entry?.tool).toBe('shell');
    expect(entry?.input).toEqual({ command: ['ls', '-la'] });
    expect(entry?.ts).toBe('2026-09-07T14:25:00.000Z');
    // Ідентифікатора сесії у рядку немає — беремо запасний із контексту.
    expect(entry?.session).toBe('lab-01');
    expect(entry?.source).toBe('codex');
  });

  it('gemini: знаходить functionCall усередині parts[]', () => {
    const line = {
      role: 'model',
      parts: [{ functionCall: { name: 'read_file', args: { absolute_path: '/tmp/x.ts' } } }],
    };
    const entry = ADAPTERS.gemini(line, ctx);
    expect(entry?.tool).toBe('read_file');
    expect(entry?.input).toEqual({ absolute_path: '/tmp/x.ts' });
    // Часу в записі немає — має підставитися запасний.
    expect(entry?.ts).toBe(ctx.ts);
  });

  it('opencode: бере інструмент і аргументи з part/state', () => {
    const line = {
      sessionID: 'ses_9',
      part: {
        type: 'tool',
        tool: 'bash',
        state: { status: 'completed', input: { command: 'npm test' } },
      },
    };
    const entry = ADAPTERS.opencode(line, ctx);
    expect(entry?.tool).toBe('bash');
    expect(entry?.input).toEqual({ command: 'npm test' });
    expect(entry?.session).toBe('ses_9');
  });

  it('сміття повертає null, а не кидає виняток', () => {
    expect(ADAPTERS['claude-code']('просто рядок', ctx)).toBeNull();
    expect(ADAPTERS.codex(42, ctx)).toBeNull();
    expect(ADAPTERS.gemini(null, ctx)).toBeNull();
    expect(ADAPTERS.opencode([1, 2, 3], ctx)).toBeNull();
  });

  it('запис без виклику інструмента пропускається', () => {
    const textOnly = {
      sessionId: 'abc-123',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Просто відповідь' }] },
    };
    expect(ADAPTERS['claude-code'](textOnly, ctx)).toBeNull();
  });
});

describe('transcript: auto і невідомі формати', () => {
  it('впізнає формат за структурою', () => {
    expect(detectSource({ sessionId: 'x', message: {} })).toBe('claude-code');
    expect(detectSource({ payload: { type: 'function_call' } })).toBe('codex');
    expect(detectSource({ parts: [] })).toBe('gemini');
    expect(detectSource({ sessionID: 'x' })).toBe('opencode');
    expect(detectSource('рядок')).toBeNull();
  });

  it('невідома структура дає null', () => {
    expect(normaliseValue('auto', { foo: 'bar' }, ctx)).toBeNull();
    expect(normaliseValue('auto', 'зовсім не JSON-об’єкт', ctx)).toBeNull();
  });

  it('auto опрацьовує запис, який не вдалося класифікувати наперед', () => {
    const generic = {
      timestamp: 1_757_255_000,
      tool: 'Bash',
      input: { command: 'npm run doctor' },
      result: 'denied',
    };
    const entry = normaliseValue('auto', generic, ctx);
    expect(entry?.tool).toBe('Bash');
    expect(entry?.result).toBe('denied');
  });
});

describe('transcript: дрібні перетворення', () => {
  it('зводить час до ISO 8601', () => {
    expect(toIsoTimestamp('2026-09-07T14:22:11.000Z', ctx.ts)).toBe('2026-09-07T14:22:11.000Z');
    expect(toIsoTimestamp(1_757_255_000, ctx.ts)).toBe(new Date(1_757_255_000_000).toISOString());
    expect(toIsoTimestamp(1_757_255_000_000, ctx.ts)).toBe(new Date(1_757_255_000_000).toISOString());
    expect(toIsoTimestamp('не дата', ctx.ts)).toBe(ctx.ts);
    expect(toIsoTimestamp(undefined, ctx.ts)).toBe(ctx.ts);
  });

  it('класифікує результат', () => {
    expect(classifyResult('denied')).toBe('denied');
    expect(classifyResult('Permission denied by user')).toBe('denied');
    expect(classifyResult('Error: ENOENT')).toBe('error');
    expect(classifyResult('success')).toBe('ok');
    expect(classifyResult(undefined)).toBe('ok');
    expect(classifyResult({ is_error: true })).toBe('error');
    expect(classifyResult('щось своє')).toBe('щось своє');
  });

  it('не дає ідентифікатору сесії вийти за межі теки', () => {
    const cleaned = sanitiseSessionId('../../etc/passwd');
    expect(cleaned).not.toContain('/');
    expect(cleaned).not.toContain('..');
    expect(sanitiseSessionId('')).toBe('session');
    expect(sanitiseSessionId('ses_9-ok.1')).toBe('ses_9-ok.1');
  });

  it('повідомляє про непридатний рядок замість того, щоб його проковтнути', () => {
    expect(parseJsonLine('{ це не json').ok).toBe(false);
    expect(parseJsonLine('').ok).toBe(false);
    expect(parseJsonLine('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('рахує зведення за інструментами й заблокованими діями', () => {
    const entries: NormalisedEntry[] = [
      { ts: ctx.ts, tool: 'Edit', input: {}, result: 'ok', session: 'a', source: 'claude-code' },
      { ts: ctx.ts, tool: 'Bash', input: {}, result: 'denied', session: 'a', source: 'claude-code' },
      { ts: ctx.ts, tool: 'Bash', input: {}, result: 'error', session: 'a', source: 'codex' },
    ];
    const stats = summariseEntries(entries);
    expect(stats.total).toBe(3);
    expect(stats.denied).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.byTool['Bash']).toBe(2);
    expect(stats.bySource['codex']).toBe(1);
  });
});
