/**
 * РЕЄСТР МОДЕЛЕЙ: ролі, а не рядки.
 *
 * ЦІНИ Й ДАТИ ПЕРЕВІРЕНО 2026-09-06 І ШВИДКО СТАРІЮТЬ.
 * Перед здачею лабораторної ти ЗОБОВ'ЯЗАНИЙ звірити кожен рядок нижче зі
 * сторінкою цін вендора. Розбіжність — це помилка в цьому файлі, а не на
 * сторінці вендора.
 *   Anthropic, ціни           — https://platform.claude.com/docs/en/about-claude/pricing
 *   Anthropic, зняття з підтр.— https://platform.claude.com/docs/en/about-claude/model-deprecations
 *   OpenAI, ціни              — https://developers.openai.com/api/docs/pricing
 *   Google Gemini, ціни       — https://ai.google.dev/gemini-api/docs/pricing
 *   Ollama (локально)         — https://ollama.com/library
 *
 * ЧОМУ РОЛІ. У коді курсу звертайся до `MODELS.cheap`, ніколи до рядка
 * "claude-...". Тоді заміна моделі — це зміна одного рядка тут, а не пошук
 * по всьому репозиторію. Ідентифікатор моделі — деталь реалізації.
 *
 * Тут немає мережевих викликів і немає секретів: лише дані та арифметика.
 */

/** Ролі, якими користується код курсу. */
export type ModelRole = 'cheap' | 'balanced' | 'frontier' | 'local' | 'embed';
// TODO(заняття 6): додати роль 'rerank' разом із реальною моделлю та її ціною
// зі сторінки вендора. Навмисно не додано наперед: вигадана ціна гірша за її
// відсутність, бо мовчки псує всі оцінки вартості.

/** Повний перелік ролей — зручно для тестів і для звітів про витрати. */
export const MODEL_ROLES = [
  'cheap',
  'balanced',
  'frontier',
  'local',
  'embed',
] as const satisfies readonly ModelRole[];

export type Provider = 'anthropic' | 'openai' | 'google' | 'ollama';

/**
 * Дата у форматі ISO `YYYY-MM-DD`, наприклад `'2026-10-15'`.
 * Формат обрано тому, що такі рядки коректно порівнюються звичайним `<`.
 *
 * TODO(студент, за бажанням): зробити з цього branded type, щоб компілятор
 * ловив рядки в іншому форматі. Шаблонний літерал-тип тут не годиться:
 * сегменти з провідним нулем (`09`) до `${number}` не підходять.
 */
export type IsoDate = string;

/** Акційна ціна, що діє включно до дати `until`. */
export interface PromoPrice {
  readonly until: IsoDate;
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

export interface ModelSpec {
  /** Ідентифікатор для API провайдера. */
  readonly id: string;
  readonly provider: Provider;
  /** USD за 1 000 000 вхідних токенів. Базова ціна: без акцій і без знижки кешу. */
  readonly inputPerMTok: number;
  /** USD за 1 000 000 вихідних токенів. */
  readonly outputPerMTok: number;
  /**
   * Мінімальний кешований префікс у токенах: коротший префікс кешувати не можна.
   * Поле відсутнє — кешування для цієї моделі не застосовне.
   */
  readonly minCachePrefixTokens?: number;
  /**
   * Вендор оголосив доступність принаймні до цієї дати; фактичне зняття може
   * статися пізніше. Поле відсутнє означає «дату не оголошено», а НЕ «модель
   * житиме вічно».
   */
  readonly retiresNotBefore?: IsoDate;
  /** Тимчасова ціна. Після `promo.until` діють `inputPerMTok`/`outputPerMTok`. */
  readonly promo?: PromoPrice;
  /** Сторінка цін вендора — те, з чим ти звіряєш рядок перед здачею. */
  readonly pricingUrl: string;
  /** Базова адреса, якщо модель обслуговує не хмара вендора, а локальний сервер. */
  readonly baseUrl?: string;
  /** Обмеження, про які легко забути й дістати помилку в рантаймі. */
  readonly notes?: readonly string[];
}

const ANTHROPIC_PRICING = 'https://platform.claude.com/docs/en/about-claude/pricing';
const OPENAI_PRICING = 'https://developers.openai.com/api/docs/pricing';
const GOOGLE_PRICING = 'https://ai.google.dev/gemini-api/docs/pricing';
const OLLAMA_LIBRARY = 'https://ollama.com/library';

/**
 * Значення змінної середовища або запасне.
 *
 * Порожній рядок трактуємо як «не задано»: після `cp .env.example .env.local`
 * змінні існують, але порожні, а `??` ловить лише `undefined` і `null` — без
 * цієї перевірки ідентифікатор локальної моделі став би порожнім рядком.
 */
function envOr(name: string, fallback: string): string {
  const raw: string | undefined = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
}

// Локальні моделі налаштовуються середовищем: у кожного студента свій ноутбук
// і свій набір завантажених моделей. Значення за замовчуванням мають працювати
// одразу після `ollama pull`; звір теги командою `ollama list` — бібліотека
// Ollama сортується за завантаженнями за весь час, тому вгорі списку
// опиняються старі покоління моделей.
const LOCAL_BASE_URL: string = envOr('OLLAMA_BASE_URL', 'http://localhost:11434');
const LOCAL_CHAT_ID: string = envOr('OLLAMA_MODEL', 'qwen3.5:4b');
const LOCAL_EMBED_ID: string = envOr('OLLAMA_EMBED_MODEL', 'nomic-embed-text');

const LOCAL_LIMITS = [
  'Локальний сервер не підтримує кешування префікса.',
  'Локальний сервер не дає надійного підрахунку токенів: облік витрат буде приблизним.',
] as const;

const LOCAL_CHAT_LIMITS = [
  ...LOCAL_LIMITS,
  'Локальний сервер не підтримує tool_choice: примусовий вибір інструмента недоступний.',
] as const;

/**
 * Каталог перевірених моделей. Ролі нижче лише посилаються сюди, тому заміна
 * моделі для ролі — це один рядок у `MODELS`, а дані лишаються поруч.
 */
export const CATALOG = {
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    inputPerMTok: 1,
    outputPerMTok: 5,
    minCachePrefixTokens: 4096,
    // Оголошено: не буде знято з підтримки раніше за цю дату.
    retiresNotBefore: '2026-10-15',
    pricingUrl: ANTHROPIC_PRICING,
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    inputPerMTok: 2,
    outputPerMTok: 10,
    minCachePrefixTokens: 1024,
    pricingUrl: ANTHROPIC_PRICING,
  },
  'claude-opus-5': {
    id: 'claude-opus-5',
    provider: 'anthropic',
    inputPerMTok: 5,
    outputPerMTok: 25,
    minCachePrefixTokens: 512,
    pricingUrl: ANTHROPIC_PRICING,
  },
  'claude-fable-5-1': {
    id: 'claude-fable-5-1',
    provider: 'anthropic',
    inputPerMTok: 10,
    outputPerMTok: 50,
    minCachePrefixTokens: 512,
    pricingUrl: ANTHROPIC_PRICING,
  },
  'gpt-5.6-luna': {
    id: 'gpt-5.6-luna',
    provider: 'openai',
    inputPerMTok: 0.2,
    outputPerMTok: 1.2,
    pricingUrl: OPENAI_PRICING,
  },
  'gpt-5.6-terra': {
    id: 'gpt-5.6-terra',
    provider: 'openai',
    inputPerMTok: 2,
    outputPerMTok: 12,
    pricingUrl: OPENAI_PRICING,
  },
  'gpt-5.6-sol': {
    id: 'gpt-5.6-sol',
    provider: 'openai',
    inputPerMTok: 4,
    outputPerMTok: 20,
    pricingUrl: OPENAI_PRICING,
  },
  'gpt-6-astra': {
    id: 'gpt-6-astra',
    provider: 'openai',
    inputPerMTok: 10,
    outputPerMTok: 50,
    pricingUrl: OPENAI_PRICING,
  },
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite',
    provider: 'google',
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    pricingUrl: GOOGLE_PRICING,
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    provider: 'google',
    // Базові (післяакційні) ціни. До 2026-12-31 включно діє promo нижче.
    inputPerMTok: 1.5,
    outputPerMTok: 7.5,
    promo: { until: '2026-12-31', inputPerMTok: 0.75, outputPerMTok: 3.75 },
    pricingUrl: GOOGLE_PRICING,
  },
  'ollama-chat': {
    id: LOCAL_CHAT_ID,
    provider: 'ollama',
    inputPerMTok: 0,
    outputPerMTok: 0,
    pricingUrl: OLLAMA_LIBRARY,
    baseUrl: LOCAL_BASE_URL,
    notes: LOCAL_CHAT_LIMITS,
  },
  'ollama-embed': {
    id: LOCAL_EMBED_ID,
    provider: 'ollama',
    inputPerMTok: 0,
    outputPerMTok: 0,
    pricingUrl: OLLAMA_LIBRARY,
    baseUrl: LOCAL_BASE_URL,
    notes: LOCAL_LIMITS,
  },
} as const satisfies Record<string, ModelSpec>;

/**
 * Прив'язка ролей до моделей — єдине місце, де її треба міняти.
 *
 * `cheap` — це не найдешевший рядок каталогу (найдешевший — `gpt-5.6-luna`), а
 * найдешевша модель, якою в курсі роблять чорнову роботу з кешуванням префікса.
 * Хочеш інакше — переприв'яжи роль і поясни вибір у звіті.
 *
 * TODO(студент): перевір, що модель кожної ролі переживе дату захисту
 * курсової, — див. `isRetiringBefore` нижче.
 */
export const MODELS = {
  cheap: CATALOG['claude-haiku-4-5-20251001'],
  balanced: CATALOG['claude-sonnet-5'],
  frontier: CATALOG['claude-opus-5'],
  local: CATALOG['ollama-chat'],
  // TODO(студент): роль `embed` навмисно вказує на локальну модель — курс не
  // фіксує хмарну модель ембедингів. Береш хмарну: додай її в CATALOG разом із
  // ціною, скопійованою зі сторінки цін вендора, і переприв'яжи роль тут.
  embed: CATALOG['ollama-embed'],
} as const satisfies Record<ModelRole, ModelSpec>;

/** Опис моделі для ролі. Повертає широкий тип: частина полів може бути відсутня. */
export function specFor(role: ModelRole): ModelSpec {
  return MODELS[role];
}

/** Сьогоднішня дата в ISO. Годинник системний, мережі тут немає. */
function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

/** Ціна, чинна на дату `at`: акційна, поки акція триває, інакше базова. */
export function effectivePrice(
  spec: ModelSpec,
  at: IsoDate = todayIso(),
): { readonly inputPerMTok: number; readonly outputPerMTok: number } {
  const promo: PromoPrice | undefined = spec.promo;
  if (promo !== undefined && at <= promo.until) {
    return { inputPerMTok: promo.inputPerMTok, outputPerMTok: promo.outputPerMTok };
  }
  return { inputPerMTok: spec.inputPerMTok, outputPerMTok: spec.outputPerMTok };
}

/**
 * Оцінка вартості одного виклику в доларах США.
 *
 * Це оцінка згори: знижки за кеш і за пакетну обробку не враховані, а локальні
 * моделі рахуються як нуль, хоча електрику й час вони витрачають.
 */
export function estimateCost(
  role: ModelRole,
  inputTokens: number,
  outputTokens: number,
  at: IsoDate = todayIso(),
): number {
  const price = effectivePrice(specFor(role), at);
  return (inputTokens / 1_000_000) * price.inputPerMTok
    + (outputTokens / 1_000_000) * price.outputPerMTok;
}

/**
 * Чи може модель ролі зникнути раніше за дату `date`?
 *
 * Потрібно для критерію курсової: модель має жити довше за дату захисту.
 * `false` означає «дату зняття не оголошено», а не «модель вічна», — тож
 * перед здачею все одно зазирни на сторінку зняття з підтримки.
 */
export function isRetiringBefore(role: ModelRole, date: IsoDate): boolean {
  const horizon: IsoDate | undefined = specFor(role).retiresNotBefore;
  if (horizon === undefined) {
    return false;
  }
  return horizon < date;
}
