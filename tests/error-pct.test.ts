import { describe, expect, it } from 'vitest';

import { errorPct } from '../src/cost';

describe('errorPct', () => {
  it('точна оцінка дає 0', () => {
    expect(errorPct(100, 100)).toBe(0);
  });

  it('оцінка 110 при фактичних 100 дає 10', () => {
    expect(errorPct(110, 100)).toBe(10);
  });

  it('оцінка 90 при фактичних 100 дає 10', () => {
    expect(errorPct(90, 100)).toBe(10);
  });
});
