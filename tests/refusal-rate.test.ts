import { describe, expect, it } from 'vitest';

import { refusalRate } from '../src/rag/answer';

describe('refusalRate', () => {
  it('повертає 0, якщо в масиві немає жодної відмови', () => {
    const answers = [
      'Коровай печуть на весілля [korovai#0001].',
      'Писанку дарували на Великдень [pysanka#0002].',
    ];
    expect(refusalRate(answers)).toBe(0);
  });

  it('повертає правильну частку, якщо частина відповідей є відмовами', () => {
    const answers = [
      'У документах колекції цього немає.',
      'Коровай печуть на весілля [korovai#0001].',
      'У документах цього немає.',
      'Писанку дарували на Великдень [pysanka#0002].',
    ];
    expect(refusalRate(answers)).toBe(0.5);
  });

  it('кидає RangeError для порожнього масиву', () => {
    expect(() => refusalRate([])).toThrow(RangeError);
    expect(() => refusalRate([])).toThrow('Масив відповідей не може бути порожнім.');
  });
});
