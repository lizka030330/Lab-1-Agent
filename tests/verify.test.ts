import { describe, expect, it } from 'vitest';

import type { Model } from '../src/agent/agent-loop';
import { isBlocked } from '../src/verify/schema';
import { filterDiff, findSecret, judgeCriterion, parseCriteria, verifyDiff } from '../src/verify/verify';

const SPEC = [
  '| # | Критерій | Чим перевіряється |',
  '|---|---|---|',
  '| A1 | `npm test` зелений | прогін CI |',
  '| A2 | набір ≥ 20 запитів | валідатор |',
].join('\n');

/** Підроблена модель: віддає заготовлені тексти по черзі й рахує виклики. */
function fake(texts: string[]): Model & { calls: number } {
  const m = Object.assign(
    async () => {
      const text = texts[m.calls] ?? '';
      m.calls++;
      return { text, calls: [], usage: { inputTokens: 1, cachedTokens: 0, outputTokens: 1 } };
    },
    { calls: 0 },
  );
  return m;
}

const verdict = (id: string, v: string, evidence = 'scripts/x.ts:1') =>
  JSON.stringify({ id, verdict: v, reason: 'тому що', evidence });

describe('parseCriteria', () => {
  it('бере лише рядки A<n> з таблиці критеріїв', () => {
    const c = parseCriteria(SPEC);
    expect(c.map((x) => x.id)).toEqual(['A1', 'A2']);
    expect(c[1]?.checkedBy).toBe('валідатор');
  });
});

describe('filterDiff і findSecret', () => {
  it('прибирає блоки файлів .env* із diff', () => {
    const diff = 'diff --git a/.env.local b/.env.local\n+KEY=1\ndiff --git a/src/a.ts b/src/a.ts\n+x\n';
    expect(filterDiff(diff)).not.toContain('.env.local');
    expect(filterDiff(diff)).toContain('src/a.ts');
  });

  it('знаходить рядок, схожий на ключ', () => {
    expect(findSecret('+GEMINI_API_KEY=AIzaSyA1234567890abcdefghijk')).toBeDefined();
    expect(findSecret('+GEMINI_API_KEY=')).toBeUndefined();
  });
});

describe('judgeCriterion', () => {
  const [a1] = parseCriteria(SPEC);
  if (a1 === undefined) throw new Error('немає A1');

  it('приймає валідний вердикт з першої спроби', async () => {
    const m = fake([verdict('A1', 'pass')]);
    expect((await judgeCriterion(m, a1, 'diff')).verdict).toBe('pass');
    expect(m.calls).toBe(1);
  });

  it('перепитує рівно один раз на невалідну відповідь', async () => {
    const m = fake(['не json', verdict('A1', 'fail')]);
    expect((await judgeCriterion(m, a1, 'diff')).verdict).toBe('fail');
    expect(m.calls).toBe(2);
  });

  it('падає після другої невалідної відповіді', async () => {
    const m = fake(['не json', '{"id":"A1","verdict":"maybe"}']);
    await expect(judgeCriterion(m, a1, 'diff')).rejects.toThrow('невалідний');
    expect(m.calls).toBe(2);
  });

  it('не приймає pass без evidence', async () => {
    const m = fake([verdict('A1', 'pass', ''), verdict('A1', 'pass', '')]);
    await expect(judgeCriterion(m, a1, 'diff')).rejects.toThrow();
  });
});

describe('брама', () => {
  it('червона, коли є хоч один fail; unknown не валить', async () => {
    const criteria = parseCriteria(SPEC);
    const red = await verifyDiff(fake([verdict('A1', 'pass'), verdict('A2', 'fail')]), criteria, 'diff');
    const green = await verifyDiff(fake([verdict('A1', 'pass'), verdict('A2', 'unknown', '')]), criteria, 'diff');
    expect(isBlocked(red)).toBe(true);
    expect(isBlocked(green)).toBe(false);
  });
});
