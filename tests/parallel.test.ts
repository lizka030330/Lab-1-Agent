import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BUDGET, MAX_WIDTH, runPool, SYSTEM, type Budget } from '../scripts/parallel-eval';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const budget = (b: Partial<Budget> = {}): Budget => ({ ...BUDGET, ...b });

describe('runPool (крок 07, без мережі)', () => {
  it('одночасно виконується не більше maxBranches гілок', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
      return 1;
    });
    await runPool(tasks, budget({ maxBranches: 3 }), () => 0);
    expect(peak).toBe(3);
  });

  it('помилка однієї гілки не губить результати інших', async () => {
    const tasks = [async () => 1, async () => { throw new Error('HTTP 429'); }, async () => 3];
    const { results } = await runPool(tasks, budget({ maxBranches: 2 }), () => 0);
    expect(results[0]).toBe(1);
    expect(results[1]).toBeInstanceOf(Error);
    expect(results[2]).toBe(3);
  });

  it('правило зупинки: після перетину стелі токенів нова гілка не стартує', async () => {
    let spent = 0;
    const tasks = Array.from({ length: 5 }, () => async () => { spent += 100; return spent; });
    const { results, stoppedEarly } = await runPool(tasks, budget({ maxBranches: 1, maxTokens: 250 }), () => spent);
    expect(stoppedEarly).toBe(true);
    expect(results.filter((r) => r !== undefined)).toHaveLength(3);
  });

  it('бюджет у коді збігається з budget.md, ширина обмежена', () => {
    expect(BUDGET).toEqual({ maxBranches: 4, maxTokens: 60_000, maxWallMs: 300_000 });
    expect(MAX_WIDTH).toBe(8);
  });

  it('SYSTEM дослівно той самий, що в eval-run.ts (крок 06)', () => {
    const src = readFileSync('scripts/eval-run.ts', 'utf8');
    for (const line of SYSTEM.split('\n')) expect(src).toContain(`'${line}'`);
  });
});
