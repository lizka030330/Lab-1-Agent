import { describe, expect, it } from 'vitest';

import {
  CATALOG,
  MODELS,
  MODEL_ROLES,
  effectivePrice,
  estimateCost,
  isRetiringBefore,
  specFor,
  type ModelSpec,
} from './models';

// Тести навмисно не ходять у мережу: реєстр — це дані й арифметика.
// Якщо ти оновив ціну в models.ts, очікувані числа тут теж треба оновити.

describe('estimateCost', () => {
  it('рахує ціну за формулою «токени / 1e6 * ціна за мільйон»', () => {
    // balanced = claude-sonnet-5: 2 USD вхід / 10 USD вихід за 1M токенів.
    // 1 000 000 вхідних = 2.00, 100 000 вихідних = 1.00 → разом 3.00.
    expect(estimateCost('balanced', 1_000_000, 100_000)).toBeCloseTo(3, 10);
  });

  it('рахує вхід і вихід за різними тарифами', () => {
    // cheap = claude-haiku-4-5: 1 / 5. 500 000 вх. = 0.50, 200 000 вих. = 1.00.
    expect(estimateCost('cheap', 500_000, 200_000)).toBeCloseTo(1.5, 10);
  });

  it('повертає нуль для локальної моделі за будь-якого обсягу токенів', () => {
    expect(estimateCost('local', 10_000_000, 10_000_000)).toBe(0);
    expect(estimateCost('embed', 10_000_000, 0)).toBe(0);
  });

  it('на нульових токенах дає нуль', () => {
    expect(estimateCost('frontier', 0, 0)).toBe(0);
  });
});

describe('effectivePrice', () => {
  const gemini: ModelSpec = CATALOG['gemini-3.8-flash'];

  it('поки акція триває, віддає акційну ціну', () => {
    expect(effectivePrice(gemini, '2026-10-01')).toEqual({
      inputPerMTok: 0.75,
      outputPerMTok: 3.75,
    });
  });

  it('останній день акції ще акційний', () => {
    expect(effectivePrice(gemini, '2026-12-31').inputPerMTok).toBe(0.75);
  });

  it('після акції повертається базова ціна', () => {
    expect(effectivePrice(gemini, '2027-01-01')).toEqual({
      inputPerMTok: 1.5,
      outputPerMTok: 7.5,
    });
  });

  it('для моделі без акції ціна не залежить від дати', () => {
    const sonnet: ModelSpec = specFor('balanced');
    expect(effectivePrice(sonnet, '2020-01-01')).toEqual(
      effectivePrice(sonnet, '2030-01-01'),
    );
  });
});

describe('isRetiringBefore', () => {
  it('для моделі з оголошеною датою: true, якщо дата раніша за задану', () => {
    // cheap = claude-haiku-4-5, доступність оголошено не раніше 2026-10-15.
    expect(isRetiringBefore('cheap', '2027-06-20')).toBe(true);
  });

  it('для моделі з оголошеною датою: false, якщо задана дата ще ближча', () => {
    expect(isRetiringBefore('cheap', '2026-09-30')).toBe(false);
  });

  it('для моделі без оголошеної дати завжди false', () => {
    expect(specFor('balanced').retiresNotBefore).toBeUndefined();
    expect(isRetiringBefore('balanced', '2030-01-01')).toBe(false);
  });
});

describe('структура реєстру', () => {
  it('усі п’ять ролей прив’язані до моделі', () => {
    expect(MODEL_ROLES).toHaveLength(5);
    for (const role of MODEL_ROLES) {
      const spec: ModelSpec = specFor(role);
      expect(spec.id.length).toBeGreaterThan(0);
      expect(spec.pricingUrl.startsWith('https://')).toBe(true);
    }
    expect(Object.keys(MODELS).sort()).toEqual([...MODEL_ROLES].sort());
  });

  it('ціни невід’ємні, а для хмарних провайдерів — додатні', () => {
    for (const role of MODEL_ROLES) {
      const spec: ModelSpec = specFor(role);
      expect(spec.inputPerMTok).toBeGreaterThanOrEqual(0);
      expect(spec.outputPerMTok).toBeGreaterThanOrEqual(0);
      if (spec.provider !== 'ollama') {
        expect(spec.inputPerMTok).toBeGreaterThan(0);
        expect(spec.outputPerMTok).toBeGreaterThan(0);
      }
    }
  });

  it('вихід дорожчий за вхід — інакше в реєстрі переплутано колонки', () => {
    const all: readonly ModelSpec[] = Object.values(CATALOG);
    for (const spec of all) {
      expect(spec.outputPerMTok).toBeGreaterThanOrEqual(spec.inputPerMTok);
    }
  });

  it('локальні моделі не обіцяють кешування префікса', () => {
    expect(specFor('local').minCachePrefixTokens).toBeUndefined();
    expect(specFor('embed').minCachePrefixTokens).toBeUndefined();
    expect(specFor('cheap').minCachePrefixTokens).toBe(4096);
  });
});
