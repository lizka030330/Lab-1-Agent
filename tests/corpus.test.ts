/**
 * Корпус Лаб. 2 (критерій A4): файли лежать у репозиторії, мережа не потрібна.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const DIR = 'docs/lab2/corpus';
const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));

describe('корпус docs/lab2/corpus', () => {
  it('містить 25 документів', () => {
    expect(files).toHaveLength(25);
  });

  it('кожен документ має заголовок із джерелом у Вікіпедії і ліцензією CC BY-SA 4.0', () => {
    for (const f of files) {
      const head = readFileSync(`${DIR}/${f}`, 'utf8').split('\n---\n')[0] ?? '';
      expect(head, f).toContain('source: https://uk.wikipedia.org/wiki/');
      expect(head, f).toContain('license: CC BY-SA 4.0');
    }
  });
});
