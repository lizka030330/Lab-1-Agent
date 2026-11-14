import { describe, expect, it } from 'vitest';

import type { Model } from '../../src/agent/agent-loop';
import { agreement, confusion } from '../../scripts/kappa';
import { buildHarnessPrompt, gatesGreen, judgeHarnessCriterion, type RunForJudge } from '../../scripts/harness/verify-run';

const run: RunForJudge = { taskId: 't-07', input: 'тести errorPct', patch: '+expect(errorPct(110, 100)).toBe(10);', acceptance: [{ cmd: 'npm test', exit: 0 }] };
const c = { id: 'C1', text: 'є тест на 110 проти 100' };
const reply = (...texts: string[]): Model => {
  let i = 0;
  return async () => ({ text: texts[Math.min(i++, texts.length - 1)] ?? '', calls: [], usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 } });
};

describe('верифікатор харнеса (крок 02, без мережі)', () => {
  it('один запит — один критерій; у промпті є задача, критерій, коди приймання і diff', () => {
    const p = buildHarnessPrompt(run, c);
    expect(p).toContain('Критерій C1');
    expect(p).toContain('npm test → 0');
    expect(p).toContain('errorPct(110, 100)');
    expect(buildHarnessPrompt({ ...run, patch: '' }, c)).toContain('порожньо');
  });

  it('строга схема: валідний вердикт приймається, think-блок qwen3 відкидається', async () => {
    const v = await judgeHarnessCriterion(reply('<think>міркую {}</think>{"id":"C1","verdict":"pass","reason":"є","evidence":"tests/e.ts:3"}'), run, c);
    expect(v.verdict).toBe('pass');
  });

  it('невалідна відповідь — рівно одне перепитування, далі помилка', async () => {
    await expect(judgeHarnessCriterion(reply('не JSON', 'знову не JSON'), run, c)).rejects.toThrow(/двічі/);
    const ok = await judgeHarnessCriterion(reply('не JSON', '{"id":"C1","verdict":"fail","reason":"ні","evidence":"x:1"}'), run, c);
    expect(ok.verdict).toBe('fail');
  });

  it('верифікатор стартує лише після зелених брам', () => {
    expect(gatesGreen({ acceptance_passed: false })).toBe(false);
    expect(gatesGreen({ acceptance_passed: true, gates: { types: 'pass', lint: 'fail' } })).toBe(false);
    expect(gatesGreen({ acceptance_passed: true, gates: {} })).toBe(true);
    expect(gatesGreen({ acceptance_passed: true, gates: { types: 'pass', lint: 'pass', tests: 'pass', build: 'pass' } })).toBe(true);
  });

  it('сира згода і каппа Коена — різні числа; каппа коригує на випадковість', () => {
    const mine = ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'fail'] as const;
    const judge = ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'pass', 'fail'] as const;
    const a = agreement([...mine], [...judge]);
    expect(a.raw).toBeCloseTo(0.8);
    expect(a.kappa).toBeCloseTo((0.8 - 0.68) / (1 - 0.68));
    expect(a.kappa).toBeLessThan(a.raw);
    expect(confusion([...mine], [...judge]).pass.fail).toBe(1);
    expect(Number.isNaN(agreement(['pass'], ['pass']).kappa)).toBe(true);
  });
});
