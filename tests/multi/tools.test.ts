import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fetchEvidence, READER_TOOL_NAMES, readerTools, RESEARCH_TOOL_NAMES, researchTools, safePath } from '../../src/multi/tools';

const root = mkdtempSync(join(tmpdir(), 'fork-'));
writeFileSync(join(root, 'a.ts'), 'one\ntwo\nthree\n');

describe('інструменти читача (Лаб. 4, крок 03)', () => {
  it('перелік інструментів — рівно читальний, без запису', () => {
    expect(Object.keys(readerTools(root)).sort()).toEqual([...READER_TOOL_NAMES].sort());
    expect(READER_TOOL_NAMES.some((n) => /write|edit|patch|delete|exec|bash|shell/i.test(n))).toBe(false);
  });

  it('шлях не виходить за корінь форка і не бачить .env / .git / node_modules', () => {
    expect(() => safePath(root, '../x')).toThrow(/поза текою/);
    expect(() => safePath(root, '/etc/passwd')).toThrow(/абсолютний/);
    expect(() => safePath(root, '.env')).toThrow(/недоступний/);
    expect(() => safePath(root, '.git/config')).toThrow(/недоступний/);
    expect(() => safePath(root, 'node_modules/x.js')).toThrow(/недоступний/);
    expect(safePath(root, 'a.ts')).toBe(join(root, 'a.ts'));
  });

  it('доказ витягує код, а не модель: рядки файлу з номерами', async () => {
    expect(await fetchEvidence(root, 'a.ts#L2-L3')).toBe('2\ttwo\n3\tthree');
    expect(await fetchEvidence(root, 'a.ts#L99')).toMatch(/лише 4 рядків/);
    expect(await fetchEvidence(root, 'якийсь текст')).toMatch(/не у форматі/);
  });

  it('дослідник (крок 04): перелік інструментів у коді == файл конфігурації, запису немає', () => {
    const cfg = JSON.parse(readFileSync('docs/lab4/research-agent.json', 'utf8')) as { allowed_tools: string[] };
    expect(Object.keys(researchTools(root)).sort()).toEqual([...cfg.allowed_tools].sort());
    expect([...RESEARCH_TOOL_NAMES].sort()).toEqual([...cfg.allowed_tools].sort());
    expect(RESEARCH_TOOL_NAMES.some((n) => /write|edit|patch|delete|exec|bash|shell/i.test(n))).toBe(false);
  });

  it('канонічність: символьне посилання всередині форка не виводить назовні', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'x');
    symlinkSync(outside, join(root, 'link'));
    expect(() => safePath(root, 'link/secret.txt')).toThrow(/посилання/);
  });
});
