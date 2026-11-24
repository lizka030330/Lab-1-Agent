import { describe, expect, it } from 'vitest';

import { add, addLost, DEFAULT_BUDGET, empty, overBudget, tokensUsed } from '../../src/multi/budget';

describe('budget (Лаб. 4, крок 03)', () => {
  it('невідомі токени не стають нулем: хід рахується як «не повідомлено»', () => {
    const s = add(empty(), { inputTokens: undefined, outputTokens: undefined }, 5);
    expect(s).toMatchObject({ calls: 1, input: 0, output: 0, unreported: 1, ms: 5 });
  });

  it('відомі токени й кеш додаються, кроки рахуються окремо від ходів', () => {
    const s = add(empty(), { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 40 } }, 7, 3);
    expect(s).toMatchObject({ calls: 1, steps: 3, input: 100, output: 20, cacheRead: 40, unreported: 0 });
    expect(tokensUsed(s)).toBe(120);
  });

  it('упала гілка все одно списує хід', () => {
    expect(addLost(empty(), 9)).toMatchObject({ calls: 1, unreported: 1, ms: 9 });
  });

  it('перевірка меж: ходи → токени → час', () => {
    const b = { ...DEFAULT_BUDGET, maxTurns: 3, tokenCeiling: 100 };
    expect(overBudget(b, empty(), 4, false)).toBe('turn-budget');
    expect(overBudget(b, add(empty(), { inputTokens: 90, outputTokens: 10 }, 1), 0, false)).toBe('token-ceiling');
    expect(overBudget(b, empty(), 1, true)).toBe('wall-clock');
    expect(overBudget(b, empty(), 3, false)).toBe('none');
  });
});
