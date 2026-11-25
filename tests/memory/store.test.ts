import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { entry, recall, reject, remember, stale, type Entry, type Roots } from '../../src/memory/store';

function repo(files: Record<string, string>): { dir: string; sha: () => string; commit: (f: string, c: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'repo-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const commit = (f: string, c: string) => { writeFileSync(join(dir, f), c); git('add', '.'); git('commit', '-qm', `c ${f}`); };
  for (const [f, c] of Object.entries(files)) commit(f, c);
  return { dir, sha: () => git('rev-parse', 'HEAD'), commit };
}

const base = (over: Partial<Entry> = {}): Entry => ({ at: '2026-11-25T10:00:00.000Z', kind: 'decision', text: 'рішення', sha: 'abcdef1', repo: 'course', paths: [], source: 'тест', ...over });

describe('памʼять харнеса — схема й відмови (крок 04)', () => {
  it('схема строга: зайве поле й невідомий kind — відмова', () => {
    expect(() => entry.parse({ ...base(), extra: 1 })).toThrow();
    expect(() => entry.parse({ ...base(), kind: 'note' })).toThrow();
    expect(() => entry.parse({ ...base(), text: 'x'.repeat(401) })).toThrow();
  });

  it('відмови: ключ, ключ=значення, цілий файл, email; звичайне твердження й хеш у source — проходять', () => {
    expect(reject({ text: 'ключ AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).toMatch(/ключ або токен/);
    expect(reject({ text: 'GOOGLE token=abcd1234efgh' })).toMatch(/ключ=значення/);
    expect(reject({ text: 'a\nb\nc\nd' })).toMatch(/цілий файл/);
    expect(reject({ text: 'пиши на a.b@example.com' })).toMatch(/персональні/);
    expect(reject({ text: 'Твердження про код — доказом path#L<рядок>.' })).toBeNull();
  });

  it('remember: відхилений запис не потрапляє в store, а відмова — у журнал', () => {
    const d = mkdtempSync(join(tmpdir(), 'mem-'));
    const file = join(d, 'store.jsonl');
    const log = join(d, 'rejected.jsonl');
    remember(base(), file, log);
    expect(() => remember(base({ text: 'a\nb\nc\nd' }), file, log)).toThrow(/відхилено/);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(readFileSync(log, 'utf8'))).toMatchObject({ why: expect.stringMatching(/цілий файл/) });
  });
});

describe('памʼять харнеса — застарілість і межі читання (крок 04)', () => {
  it('застаріле, лише якщо ПІСЛЯ sha змінювали саме цей шлях — і в ТОМУ репозиторії', () => {
    const course = repo({ 'a.ts': '1', 'b.ts': '1' });
    const fork = repo({ 'x.ts': '1' });
    const roots: Roots = { course: course.dir, fork: fork.dir };
    const at = course.sha();
    course.commit('b.ts', '2'); // змінено b.ts, не a.ts
    expect(stale(base({ sha: at, paths: ['a.ts'] }), roots)).toBe(false); // давно не змінюваний файл — свіжий
    expect(stale(base({ sha: at, paths: ['b.ts'] }), roots)).toBe(true);
    expect(stale(base({ sha: at, repo: 'fork', paths: ['x.ts'] }), roots)).toBe(true); // sha курсового репо у форку невідомий → застаріле (закрито)
    expect(stale(base({ sha: fork.sha(), repo: 'fork', paths: ['x.ts'] }), roots)).toBe(false);
    expect(stale(base({ sha: 'deadbeef', paths: ['a.ts'] }), roots)).toBe(true); // невідомий коміт = застаріле
  });

  it('recall: застарілі не вантажить, дві межі, найновіші першими, числа обрізаного', () => {
    const course = repo({ 'a.ts': '1' });
    const roots: Roots = { course: course.dir, fork: course.dir };
    const d = mkdtempSync(join(tmpdir(), 'mem-'));
    const file = join(d, 'store.jsonl');
    const sha = course.sha();
    for (let i = 1; i <= 5; i++) remember(base({ at: `2026-11-25T10:0${i}:00.000Z`, sha, text: `запис ${i}`, paths: ['a.ts'] }), file, join(d, 'r.jsonl'));
    remember(base({ sha: 'deadbeef', text: 'застарілий', paths: ['a.ts'] }), file, join(d, 'r.jsonl'));
    const r = recall({ file, roots, maxEntries: 3 });
    expect(r).toMatchObject({ total: 6, staleDropped: 1, used: 3, cutEntries: 2 });
    expect(r.text.split('\n')[0]).toContain('запис 5');
    expect(r.text).not.toContain('застарілий');
    expect(r.cutBytes).toBeGreaterThan(0);
    const b = recall({ file, roots, maxBytes: 60 });
    expect(b.used).toBeLessThan(5);
  });
});
