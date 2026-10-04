/**
 * Виміри вартості для кроку 07. ХОДИТЬ У МЕРЕЖУ, тому це не тест: запускається лише
 * вручну з кореня репозиторію (ключі з .env.local підхоплює прапорець --env-file):
 *
 *   npx tsx --env-file=.env.local scripts/measure-cost.ts gemini   оцінка до виклику vs факт + кеш
 *   npx tsx --env-file=.env.local scripts/measure-cost.ts ollama   кеш на локальній моделі
 *   npx tsx --env-file=.env.local scripts/measure-cost.ts lang docs/lab1/cost.md   множник ua/en за блоками ```ua і ```en
 *
 * Друкує рядки для docs/lab1/cost.md. Через безкоштовний рівень ідуть лише код шаблону і ваші навчальні тексти.
 */
import { readFile } from 'node:fs/promises';

import {
  COST_TABLE_HEADER,
  costTableRow,
  errorPct,
  fromGeminiUsage,
  fromMessagesUsage,
  languageMultiplier,
  priceUsd,
  withinTolerance,
  type GeminiUsage,
  type MessagesUsage,
  type Usage,
} from '../src/cost';
import { CATALOG, MODELS, type ModelSpec } from '../src/models';

const GEMINI = CATALOG['gemini-3.8-flash'];
const LOCAL = MODELS.local; // модель — з OLLAMA_MODEL у .env.local; для кешу беріть qwen3:4b
const QUESTION = 'Одним реченням: що перевіряє scripts/doctor.ts?';

// Стабільний префікс: ті самі файли в тому самому порядку. Для кешу gemini-3.8-flash — від 4096 токенів.
const PREFIX_FILES = ['scripts/doctor.ts', 'scripts/sync-skills.ts', 'src/models.ts'];
const PREFIX = (await Promise.all(PREFIX_FILES.map((file) => readFile(file, 'utf8')))).join('\n\n');
const SYSTEM = `Ти рецензент коду. Код проєкту:\n\n${PREFIX}`;
// Малій локальній моделі — коротший (перші 6000 символів), але так само стабільний префікс.
const LOCAL_SYSTEM = SYSTEM.slice(0, 6_000);

/** POST із виміром повного часу запиту — до останнього байта відповіді. */
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ json: unknown; ms: number }> {
  const started = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  return { json: JSON.parse(text), ms };
}

function gemini(method: 'countTokens' | 'generateContent', body: unknown): Promise<{ json: unknown; ms: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY порожній: заповніть .env.local');
  return post(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI.id}:${method}`, { 'x-goog-api-key': key }, body);
}

function report(run: string, spec: ModelSpec, usage: Usage, ms: number, estimatedInput?: number): void {
  console.log(
    costTableRow({
      run,
      provider: spec.provider,
      model: spec.id,
      usage,
      actualUsd: 0, // безкоштовний рівень або локальна модель
      listUsd: priceUsd(spec, usage),
      latencyMs: ms,
      date: new Date().toISOString().slice(0, 10),
      ...(estimatedInput === undefined ? {} : { estimatedInput }),
    }),
  );
  if (estimatedInput !== undefined) {
    const verdict = withinTolerance(estimatedInput, usage.inputTokens) ? 'у межах 10%' : 'ПОНАД 10%';
    console.log(`  оцінка ${estimatedInput} vs факт ${usage.inputTokens}: ${errorPct(estimatedInput, usage.inputTokens).toFixed(1)}% — ${verdict}`);
  }
}

async function measureGemini(): Promise<void> {
  const request = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: QUESTION }] }],
  };
  // Оцінка ДО виклику: ті самі systemInstruction і contents, що підуть у generateContent.
  const counted = await gemini('countTokens', { generateContentRequest: { model: `models/${GEMINI.id}`, ...request } });
  const estimate = (counted.json as { totalTokens: number }).totalTokens;
  if (estimate < 4096) console.warn(`Префікс лише ${estimate} токенів: неявний кеш ${GEMINI.id} починається від 4096.`);
  console.log(COST_TABLE_HEADER);
  // Неявний кеш не гарантований: до трьох однакових викликів поспіль.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { json, ms } = await gemini('generateContent', request);
    const raw = (json as { usageMetadata: GeminiUsage }).usageMetadata;
    console.log('  сирий usageMetadata:', JSON.stringify(raw));
    const usage = fromGeminiUsage(raw);
    report(`gemini-${attempt}`, GEMINI, usage, ms, estimate);
    if (attempt >= 2 && usage.cachedTokens > 0) return;
  }
  console.warn('Кешованих токенів немає після трьох спроб — доведіть кеш на Ollama (режим ollama).');
}

async function ollamaMessages(system: string | undefined, content: string, maxTokens: number) {
  const { json, ms } = await post(`${LOCAL.baseUrl}/v1/messages`, {}, {
    model: LOCAL.id,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
  });
  return { raw: (json as { usage: MessagesUsage }).usage, ms };
}

async function measureOllama(): Promise<void> {
  console.log(COST_TABLE_HEADER);
  for (const run of ['ollama-1', 'ollama-2']) {
    // ТОЧНО той самий запит двічі поспіль, поки модель у пам'яті
    const { raw, ms } = await ollamaMessages(LOCAL_SYSTEM, QUESTION, 64);
    console.log('  сирий usage:', JSON.stringify(raw));
    report(run, LOCAL, fromMessagesUsage(raw), ms);
  }
}

/** Тексти для множника лежать у docs/lab1/cost.md, розділ 3: блоки ```ua і ```en. */
function langBlock(md: string, tag: 'ua' | 'en'): string {
  const open = '```' + tag + '\n';
  const start = md.indexOf(open);
  const end = start === -1 ? -1 : md.indexOf('```', start + open.length);
  const text = end === -1 ? '' : md.slice(start + open.length, end).trim();
  if (text === '') throw new Error(`У cost.md немає непорожнього блоку ${'```' + tag}`);
  return text;
}

async function measureLang(costMdPath: string): Promise<void> {
  const md = (await readFile(costMdPath, 'utf8')).replaceAll('\r\n', '\n');
  const ua = langBlock(md, 'ua');
  const en = langBlock(md, 'en');
  if (process.env.GEMINI_API_KEY) {
    const count = async (text: string): Promise<number> =>
      ((await gemini('countTokens', { contents: [{ role: 'user', parts: [{ text }] }] })).json as { totalTokens: number }).totalTokens;
    const u = await count(ua);
    const e = await count(en);
    console.log(`google · ${GEMINI.id} · ${languageMultiplier(u, e).toFixed(2)}  (ua ${u} / en ${e})`);
  }
  try {
    // Локальна модель додає до тексту шаблон чату — віднімаємо його, виміряний на одному символі.
    const tokens = async (text: string): Promise<number> =>
      fromMessagesUsage((await ollamaMessages(undefined, text, 1)).raw).inputTokens;
    const base = await tokens('.');
    const u = (await tokens(ua)) - base;
    const e = (await tokens(en)) - base;
    console.log(`ollama · ${LOCAL.id} · ${languageMultiplier(u, e).toFixed(2)}  (ua ${u} / en ${e}, шаблон ${base})`);
  } catch (error) {
    console.warn('Ollama не відповідає — пропускаю:', error instanceof Error ? error.message : error);
  }
}

const [mode, costMd] = process.argv.slice(2);
if (mode === 'gemini') {
  await measureGemini();
} else if (mode === 'ollama') {
  await measureOllama();
} else if (mode === 'lang' && costMd) {
  await measureLang(costMd);
} else {
  console.error('Використання: npx tsx --env-file=.env.local scripts/measure-cost.ts gemini | ollama | lang docs/lab1/cost.md');
  process.exitCode = 1;
}