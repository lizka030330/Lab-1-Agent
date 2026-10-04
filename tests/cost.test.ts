import { describe, expect, it } from 'vitest';

import {
  COST_TABLE_HEADER,
  costTableRow,
  errorPct,
  fromChatUsage,
  fromGeminiUsage,
  fromMessagesUsage,
  languageMultiplier,
  priceUsd,
  withinTolerance,
} from '../src/cost';
import { CATALOG, estimateCost, specFor } from '../src/models';

// Без мережі: лише нормалізація usage і арифметика. Реальні виміри — scripts/measure-cost.ts.

describe('нормалізація usage', () => {
  it('Messages-форма: input_tokens без кешованих — додаємо cache_read_input_tokens', () => {
    expect(fromMessagesUsage({ input_tokens: 24, cache_read_input_tokens: 4_000, output_tokens: 9 })).toEqual({
      inputTokens: 4_024,
      cachedTokens: 4_000,
      outputTokens: 9,
    });
  });

  it('Messages-форма без полів кешу (перший виклик) — кешованих 0', () => {
    expect(fromMessagesUsage({ input_tokens: 4_024, output_tokens: 9 }).cachedTokens).toBe(0);
  });

  it('Chat Completions: prompt_tokens — уже повний вхід; деталізації може не бути', () => {
    expect(
      fromChatUsage({ prompt_tokens: 1_000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 900 } }),
    ).toEqual({ inputTokens: 1_000, cachedTokens: 900, outputTokens: 5 });
    expect(fromChatUsage({ prompt_tokens: 1_000, completion_tokens: 5 }).cachedTokens).toBe(0);
  });

  it('Gemini generateContent: promptTokenCount містить кешовані; роздуми — у вихід', () => {
    expect(
      fromGeminiUsage({ promptTokenCount: 5_200, cachedContentTokenCount: 4_100, candidatesTokenCount: 20, thoughtsTokenCount: 80 }),
    ).toEqual({ inputTokens: 5_200, cachedTokens: 4_100, outputTokens: 100 });
  });
});

describe('звірка оцінки з фактом', () => {
  it('рахує похибку у відсотках', () => {
    expect(errorPct(95, 100)).toBeCloseTo(5, 10);
    expect(errorPct(105, 100)).toBeCloseTo(5, 10);
  });

  it('межа 10% включна', () => {
    expect(withinTolerance(110, 100)).toBe(true);
    expect(withinTolerance(111, 100)).toBe(false);
  });

  it('пастка Messages-форми: без додавання кешу правильна оцінка виглядає як промах', () => {
    const raw = { input_tokens: 24, cache_read_input_tokens: 4_000, output_tokens: 9 };
    const estimate = 4_050;
    expect(withinTolerance(estimate, raw.input_tokens)).toBe(false);
    expect(withinTolerance(estimate, fromMessagesUsage(raw).inputTokens)).toBe(true);
  });

  it('нульовий факт — помилка виміру, а не 0%', () => {
    expect(() => errorPct(10, 0)).toThrow(RangeError);
  });
});

describe('вартість за прайсом models.ts', () => {
  it('для ролі збігається з estimateCost', () => {
    const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 100_000 };
    expect(priceUsd(specFor('balanced'), usage)).toBeCloseTo(estimateCost('balanced', 1_000_000, 100_000), 10);
  });

  it('бере акційну ціну Gemini за датою', () => {
    const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 };
    expect(priceUsd(CATALOG['gemini-3.8-flash'], usage, '2026-09-14')).toBeCloseTo(0.75, 10);
    expect(priceUsd(CATALOG['gemini-3.8-flash'], usage, '2027-01-01')).toBeCloseTo(1.5, 10);
  });

  it('локальна модель коштує 0', () => {
    expect(priceUsd(specFor('local'), { inputTokens: 50_000, cachedTokens: 0, outputTokens: 5_000 })).toBe(0);
  });
});

describe('множник ua/en і рядок таблиці', () => {
  it('множник — відношення кількостей токенів', () => {
    expect(languageMultiplier(150, 100)).toBeCloseTo(1.5, 10);
    expect(() => languageMultiplier(150, 0)).toThrow(RangeError);
  });

  it('рядок має стільки колонок, скільки заголовок; для локальної моделі оцінки немає', () => {
    const cells = (line: string): string[] => line.split('|').slice(1, -1).map((c) => c.trim());
    const row = costTableRow({
      run: 'ollama-2',
      provider: 'ollama',
      model: 'qwen3:4b',
      usage: { inputTokens: 4_024, cachedTokens: 4_000, outputTokens: 9 },
      actualUsd: 0,
      listUsd: 0,
      latencyMs: 812.4,
      date: '2026-09-14',
    });
    expect(cells(row)).toHaveLength(cells(COST_TABLE_HEADER.split('\n')[0] ?? '').length);
    expect(cells(row)).toEqual([
      'ollama-2', 'ollama', 'qwen3:4b', '4024', '4000', '9', '—', '—', '0.000000', '0.000000', '812', '2026-09-14',
    ]);
  });

  it('для хмарної моделі рядок містить оцінку і похибку', () => {
    const row = costTableRow({
      run: 'gemini-1',
      provider: 'google',
      model: 'gemini-3.8-flash',
      usage: { inputTokens: 5_000, cachedTokens: 0, outputTokens: 40 },
      estimatedInput: 4_900,
      actualUsd: 0,
      listUsd: 0.00390,
      latencyMs: 1_530,
      date: '2026-09-14',
    });
    expect(row).toContain('| 4900 | 2.0 |');
  });
});