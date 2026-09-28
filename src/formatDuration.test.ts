import { describe, expect, it } from 'vitest';

import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  it.each([
    [0, '00:00:00'],
    [999, '00:00:00'],
    [1000, '00:00:01'],
    [59_999, '00:00:59'],
    [60_000, '00:01:00'],
    [65_000, '00:01:05'],
    [3_599_999, '00:59:59'],
    [3_600_000, '01:00:00'],
    [3_661_999.5, '01:01:01'],
    [86_400_000, '24:00:00'],
    [360_000_000, '100:00:00'],
  ])('форматує %s мс як %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it.each([-1, NaN, Infinity, -Infinity])('відхиляє некоректне значення %s', (ms) => {
    expect(() => formatDuration(ms)).toThrow(RangeError);
  });
});
