/**
 * Цитати глибокого дослідження (Лаб. 4, крок 04). Перевіряє КОД, до будь-якої моделі:
 * коміт — git cat-file -e <sha>^{commit}; рядок — git blame -L n,n <sha> -- <file> (рядок існує САМЕ на цьому коміті).
 * Формати в тексті: `src/index.ts#L460@c439054` або `commit:22a9679`.
 */
import { execFileSync } from 'node:child_process';

export type Cite = { sha: string; file?: string; line?: number };

export const FORK_URL = 'https://github.com/lizka030330/path-to-regexp';

export function parseCite(s: string): Cite | null {
  const t = s.trim().replace(/^`|`$/g, '');
  const c = t.match(/^commit:([0-9a-f]{7,40})$/);
  if (c?.[1]) return { sha: c[1] };
  const f = t.match(/^([\w./-]+)#L(\d+)(?:-L?\d+)?@([0-9a-f]{7,40})$/);
  if (f?.[1] && f[2] && f[3]) return { file: f[1], line: Number(f[2]), sha: f[3] };
  return null;
}

export function check(c: Cite, forkDir: string): string | null {
  const git = (args: string[]) => execFileSync('git', args, { cwd: forkDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['cat-file', '-e', `${c.sha}^{commit}`]);
  } catch {
    return `коміту ${c.sha} у форку немає`;
  }
  if (c.file === undefined || c.line === undefined) return null;
  if (c.file.includes('..') || c.file.startsWith('/')) return `шлях ${c.file} не в межах форка`;
  try {
    git(['blame', '-L', `${c.line},${c.line}`, c.sha, '--', c.file]); // -L n,n прив'язує цитату до рядка на коміті
  } catch {
    return `${c.file}:${c.line} на ${c.sha} не існує`;
  }
  return null;
}

/** Рядок файлу на коміті — для верифікатора (модель бачить справжній текст, а не слова звідника). */
export function lineAt(c: Cite, forkDir: string, context = 3): string {
  if (!c.file || !c.line) {
    return execFileSync('git', ['show', '--stat', '--format=%h %as %an%n%s%n%b', c.sha], { cwd: forkDir, encoding: 'utf8' }).slice(0, 4000);
  }
  const text = execFileSync('git', ['show', `${c.sha}:${c.file}`], { cwd: forkDir, encoding: 'utf8' }).split('\n');
  const from = Math.max(1, c.line - context);
  return text.slice(from - 1, c.line + context).map((l, i) => `${from + i}\t${l}`).join('\n');
}

export function permalink(c: Cite, fullSha: string): string {
  return c.file ? `${FORK_URL}/blob/${fullSha}/${c.file}#L${c.line}` : `${FORK_URL}/commit/${fullSha}`;
}

export function fullSha(sha: string, forkDir: string): string {
  return execFileSync('git', ['rev-parse', `${sha}^{commit}`], { cwd: forkDir, encoding: 'utf8' }).trim();
}
