import { describe, expect, it } from 'vitest';

import { verdictOf } from '../../scripts/harness/record-gates.mjs';

describe('record-gates: вердикт брами (крок 01, без мережі)', () => {
  it('зелена брама з підтвердженням verdict=pass — pass', () => {
    expect(verdictOf('success', 'pass')).toBe('pass');
  });
  it('впала брама — fail, навіть коли outputs.verdict порожній', () => {
    expect(verdictOf('failure', '')).toBe('fail');
  });
  it('пропущена чи скасована брама — skipped, а не fail', () => {
    expect(verdictOf('skipped', '')).toBe('skipped');
    expect(verdictOf('cancelled', '')).toBe('skipped');
  });
  it('зелена без підтвердження у виході — не довіряємо: fail', () => {
    expect(verdictOf('success', '')).toBe('fail');
  });
});
