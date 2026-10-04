/**
 * ОБЛІК ВАРТОСТІ (крок 07): оцінка до виклику і звірка з фактом після.
 *
 * Як і в models.ts, тут немає мережі: лише нормалізація полів `usage` різних
 * форм API і арифметика. Мережеві виміри — у scripts/measure-cost.ts.
 * Ціни не дублюються: беремо їх через `effectivePrice` з models.ts.
 */
import { effectivePrice, type IsoDate, type ModelSpec } from './models';

/** Облік одного виклику в єдиній формі для всіх API. */
export interface Usage {
  /** Повний вхід, ВКЛЮЧНО з прочитаними з кешу токенами. */
  readonly inputTokens: number;
  /** Скільки з `inputTokens` прочитано з кешу. */
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/** Messages-форма (Anthropic, Ollama /v1/messages). */
export interface MessagesUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

/** Тут `input_tokens` НЕ містить кешованих: повний вхід треба скласти самому. */
export function fromMessagesUsage(u: MessagesUsage): Usage {
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    inputTokens: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0),
    cachedTokens: cached,
    outputTokens: u.output_tokens,
  };
}

/** Chat Completions (Gemini OpenAI-сумісний, Ollama /v1/chat/completions). */
export interface ChatUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number };
}

/** Тут `prompt_tokens` — уже повний вхід, кешовані — лише деталізація. */
export function fromChatUsage(u: ChatUsage): Usage {
  return {
    inputTokens: u.prompt_tokens,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u.completion_tokens,
  };
}

/** Gemini generateContent: поле `usageMetadata`. */
export interface GeminiUsage {
  readonly promptTokenCount: number;
  readonly candidatesTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly thoughtsTokenCount?: number;
}

/** `promptTokenCount` уже містить кешовані; роздуми тарифікуються як вихід. */
export function fromGeminiUsage(u: GeminiUsage): Usage {
  return {
    inputTokens: u.promptTokenCount,
    cachedTokens: u.cachedContentTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

/** Відносна похибка оцінки у відсотках: |оцінка − факт| / факт × 100. */
export function errorPct(estimated: number, actual: number): number {
  if (actual <= 0) {
    throw new RangeError('Фактична кількість токенів має бути більшою за нуль');
  }
  return (Math.abs(estimated - actual) / actual) * 100;
}

/** Критерій кроку 07 (лише для хмарної моделі): похибка не більша за 10%. */
export function withinTolerance(estimated: number, actual: number, maxPct = 10): boolean {
  return errorPct(estimated, actual) <= maxPct;
}

/** Множник «українська / англійська» для того самого змісту. */
export function languageMultiplier(uaTokens: number, enTokens: number): number {
  if (enTokens <= 0) {
    throw new RangeError('Кількість англійських токенів має бути більшою за нуль');
  }
  return uaTokens / enTokens;
}

/**
 * Вартість за прайсом models.ts — оцінка згори, як і `estimateCost`: знижку за
 * кеш не враховано. Приймає ModelSpec, бо безкоштовна хмарна модель курсу
 * (gemini-3.8-flash) не прив'язана до ролі; для ролі передайте `specFor(role)`.
 */
export function priceUsd(spec: ModelSpec, usage: Usage, at?: IsoDate): number {
  const price = effectivePrice(spec, at);
  return (usage.inputTokens / 1_000_000) * price.inputPerMTok
    + (usage.outputTokens / 1_000_000) * price.outputPerMTok;
}

/** Рядок таблиці docs/lab1/cost.md (формат курсу). */
export interface CostRow {
  readonly run: string;
  readonly provider: string;
  readonly model: string;
  readonly usage: Usage;
  /** Оцінка входу до виклику. Немає — для локальної моделі (ендпоінта підрахунку немає). */
  readonly estimatedInput?: number;
  readonly actualUsd: number;
  readonly listUsd: number;
  /** Повний час запиту до останнього байта. */
  readonly latencyMs: number;
  readonly date: IsoDate;
}

export const COST_TABLE_HEADER = [
  '| прогін | провайдер | модель | вхідні | кешовані | вихідні | оцінка входу до виклику | похибка % | $ фактично | $ за прайсом models.ts | затримка, мс | дата |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
].join('\n');

export function costTableRow(r: CostRow): string {
  const est = r.estimatedInput;
  const cells = [
    r.run,
    r.provider,
    r.model,
    String(r.usage.inputTokens),
    String(r.usage.cachedTokens),
    String(r.usage.outputTokens),
    est === undefined ? '—' : String(est),
    est === undefined ? '—' : errorPct(est, r.usage.inputTokens).toFixed(1),
    r.actualUsd.toFixed(6),
    r.listUsd.toFixed(6),
    String(Math.round(r.latencyMs)),
    r.date,
  ];
  return `| ${cells.join(' | ')} |`;
}