import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseAnswer } from '../src/multimodal/ask';
import { MAX_BYTES, precheck } from '../src/multimodal/limits';
import { imageTokens, pdfPages, pdfTokens, pngSize } from '../src/multimodal/predict';
import { wordRecall } from '../src/multimodal/speak';

describe('мультимодальність — детерміновані частини (крок 05)', () => {
  it('precheck: та сама перевірка, що в браузері й на сервері', () => {
    expect(precheck({ size: 10, type: 'image/tiff' }, 'що тут')?.reason).toBe('mediaType');
    expect(precheck({ size: MAX_BYTES + 1, type: 'application/pdf' }, 'що тут')?.reason).toBe('size');
    expect(precheck({ size: 10, type: 'image/png' }, '')?.reason).toBe('question');
    expect(precheck(null, 'текстова база')).toBeNull();
    expect(MAX_BYTES).toBeLessThan(4_500_000);
  });

  it('прогноз токенів: PDF 258/стор., зображення 258 або плитки 768×768', () => {
    expect(pdfTokens(3)).toBe(774);
    expect(imageTokens(320, 200)).toBe(258);
    expect(imageTokens(1600, 1200)).toBe(1548);
    expect(imageTokens(768, 1000)).toBe(516);
  });

  it('розміри й сторінки читаються з самих файлів набору', () => {
    expect(pngSize(new Uint8Array(readFileSync('fixtures/multimodal/big-1600x1200.png')))).toEqual({ w: 1600, h: 1200 });
    expect(pdfPages(new Uint8Array(readFileSync('fixtures/multimodal/spec-3p.pdf')))).toBe(3);
  });

  it('розбір відповіді: номер сторінки і «не знаю»', () => {
    expect(parseAnswer('Відповідь: 45 секунд\nСторінка: 3')).toEqual({ answer: '45 секунд', page: 3, unknown: false });
    expect(parseAnswer('Відповідь: не знаю\nСторінка: —')).toMatchObject({ page: null, unknown: true });
  });

  it('round-trip: частка слів оригіналу в транскрипті', () => {
    expect(wordRecall('Харнес перевіряє цитату.', 'харнес перевіряє цитату')).toBe(1);
    expect(wordRecall('a b c d', 'a b')).toBe(0.5);
  });
});
