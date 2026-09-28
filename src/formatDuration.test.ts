import { describe, expect, it } from 'vitest';

import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  it.each([
    [0, '0ms'],
    [500, '500ms'],
    [999.9, '999ms'],
    [1_000, '1s'],
    [1_500, '1.5s'],
    [59_999, '59.999s'],
    [60_000, '1m 0s'],
    [65_250, '1m 5.25s'],
    [3_600_000, '60m 0s'],
  ])('форматує %s мс як %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it.each([-1, NaN, Infinity, -Infinity])('відхиляє %s', (ms) => {
    expect(() => formatDuration(ms)).toThrow(RangeError);
  });
});
