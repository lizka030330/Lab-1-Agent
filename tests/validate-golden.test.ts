import { describe, expect, it } from 'vitest';

import { validateGolden } from '../scripts/validate-golden';

const LOOSE = { total: 1, unanswerable: 0, injection: 0 };
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const ok = {
  id: 'q-01',
  query: 'Який строк подання заявки?',
  expected: ['30 днів'],
  must_cite: ['doc-01'],
  tags: ['easy'],
};

describe('validateGolden', () => {
  it('приймає коректний рядок', () => {
    expect(validateGolden(line(ok), LOOSE)).toEqual([]);
  });

  it('не приймає порожній must_cite поза unanswerable', () => {
    expect(validateGolden(line({ ...ok, must_cite: [] }), LOOSE).join(' ')).toContain('must_cite');
  });

  it('ловить повтор id', () => {
    expect(validateGolden(`${line(ok)}\n${line(ok)}`, LOOSE).join(' ')).toContain('повторюється');
  });

  it('ловить витік відповіді в текст запиту', () => {
    const leaky = {
      ...ok,
      query: 'Чи правда, що строк подання — 30 календарних днів?',
      expected: ['строк подання — 30 календарних днів'],
    };
    expect(validateGolden(line(leaky), LOOSE).join(' ')).toContain('дослівно');
  });

  it('вимагає порогів подання', () => {
    expect(validateGolden(line(ok)).join(' ')).toContain('потрібно ≥ 20');
  });

  it('переживає CRLF і BOM', () => {
    expect(validateGolden(`\uFEFF${line(ok)}\r\n\r\n`, LOOSE)).toEqual([]);
  });
});