import { describe, expect, it } from 'vitest';

import { compare, summarize, toBaseline, type Line } from '../../scripts/evals/summary';

const L = (task_id: string, attempt: number, pass: boolean, bucket = 'regression', frozen_at = '2026-11-19'): Line =>
  ({ task_id, bucket, frozen_at, attempt, pass, duration_s: attempt * 10, input_tokens: 100, output_tokens: 10, cost_usd_estimate: 0.001 });

describe('pass@k, pass^k і брама (крок 04)', () => {
  const run = [
    L('a', 1, true), L('a', 2, true), L('a', 3, true), // 3/3
    L('b', 1, true), L('b', 2, false), L('b', 3, true), // 2/3
    L('c', 1, false), L('c', 2, false), L('c', 3, false), // 0/3
    L('e', 1, true, 'edge'), L('e', 2, false, 'edge'), L('e', 3, false, 'edge'),
  ];

  it('pass@k і pass^k — окремі числа, pass^k не більше за pass@k', () => {
    const [edge, reg] = summarize(run, 3);
    expect(reg).toMatchObject({ bucket: 'regression', tasks: 3, pass_at_k: 2 / 3, pass_pow_k: 1 / 3, median_duration_s: 20 });
    expect(edge).toMatchObject({ bucket: 'edge', tasks: 1, pass_at_k: 1, pass_pow_k: 0 });
  });

  it('брама: задача з pass^k = 1 у базовому рівні впала — регресія, поіменно', () => {
    const base = toBaseline(run, 3);
    expect(base.a?.pow_k).toBe(1);
    expect(compare(run, base)).toEqual({ ok: true, problems: [], checked: 1 });
    const now = [L('a', 1, false), L('b', 1, true), L('c', 1, true)];
    const r = compare(now, base);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['a: було pass^3 = 1, стало 0/1']);
  });

  it('середнє те саме, а задача зламалась — брама все одно бачить', () => {
    const base = toBaseline([L('a', 1, true), L('b', 1, false)], 1);
    const now = [L('a', 1, false), L('b', 1, true)]; // 50% і 50%
    expect(compare(now, base).problems).toEqual(['a: було pass^1 = 1, стало 0/1']);
  });

  it('незаморожений банк, інший банк, непрогнана задача — теж провал', () => {
    const base = toBaseline([L('a', 1, true)], 1);
    expect(compare([L('a', 1, true), L('x', 1, true, 'regression', '2026-11-20')], base).problems[0]).toContain('не заморожений');
    expect(compare([L('a', 1, true, 'regression', '2026-11-20')], base).problems[0]).toContain('різних банків');
    expect(compare([L('z', 1, true)], base).problems).toEqual(['a: була pass^1 = 1, а зараз не прогонялась']);
  });

  it('edge у брамі не бере участі', () => {
    const base = toBaseline([L('e', 1, true, 'edge')], 1);
    expect(compare([L('e', 1, false, 'edge')], base).ok).toBe(true);
  });
});
