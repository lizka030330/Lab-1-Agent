import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { check, lineAt, parseCite } from '../../src/research/cite';

const dir = mkdtempSync(join(tmpdir(), 'cite-'));
const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 't@t');
git('config', 'user.name', 't');
writeFileSync(join(dir, 'm.ts'), 'один\nдва\nтри\n');
git('add', '.');
git('commit', '-qm', 'перший');
const sha = git('rev-parse', 'HEAD');

describe('цитати дослідження — перевіряє код (крок 04)', () => {
  it('розбирає два формати і відкидає решту', () => {
    expect(parseCite('commit:abc1234')).toEqual({ sha: 'abc1234' });
    expect(parseCite('src/index.ts#L460@c439054')).toEqual({ file: 'src/index.ts', line: 460, sha: 'c439054' });
    expect(parseCite('src/index.ts#L460')).toBeNull(); // без sha — не цитата
    expect(parseCite('див. файл')).toBeNull();
  });

  it('коміт і рядок існують — null; інакше причина', () => {
    expect(check({ sha }, dir)).toBeNull();
    expect(check({ sha, file: 'm.ts', line: 2 }, dir)).toBeNull();
    expect(check({ sha, file: 'm.ts', line: 99 }, dir)).toMatch(/не існує/);
    expect(check({ sha: 'deadbeef' }, dir)).toMatch(/немає/);
    expect(check({ sha, file: '../x', line: 1 }, dir)).toMatch(/не в межах/);
  });

  it('lineAt повертає справжній рядок на коміті з номерами', () => {
    expect(lineAt({ sha, file: 'm.ts', line: 2 }, dir, 0)).toBe('2\tдва');
  });
});
