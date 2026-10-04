# Вартість викликів — Лабораторна 1

Ollama: `ollama version is 0.34.4` · дата вимірів: 2026-10-04

Звірка цін у src/models.ts: 2026-10-04. Google (gemini-3.8-flash, gemini-3.5-flash-lite), Anthropic (claude-haiku-4-5, claude-sonnet-5, claude-opus-5, claude-fable-5-1), OpenAI (gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol, gpt-6-astra) — усі збігаються зі сторінками вендорів, models.ts не змінювався. Примітка: ціна gpt-5.6-sol на сторінці OpenAI позначена як акційна «щонайменше до 21.11.2026», базову ціну після акції не вказано.

## 1. Звірка оцінки вхідних токенів (хмарна модель, критерій ≤ 10%)

| прогін | провайдер | модель | вхідні | кешовані | вихідні | оцінка входу до виклику | похибка % | $ фактично | $ за прайсом models.ts | затримка, мс | дата |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gemini-1 | google | gemini-3.8-flash | 14208 | 12158 | 664 | 14208 | 0.0 | 0.000000 | 0.013146 | 6664 | 2026-10-04 |

Команда: npx tsx --env-file=.env.local scripts/measure-cost.ts gemini
Чим оцінено до виклику: Gemini countTokens (REST, generateContentRequest) · факт: usageMetadata.promptTokenCount

Вердикт: оцінка 14208 vs факт 14208 — похибка 0.0%, у межах 10%.

Сирий usageMetadata: `{"promptTokenCount":14208,"candidatesTokenCount":69,"totalTokenCount":14872,"cachedContentTokenCount":12158,"promptTokensDetails":[{"modality":"TEXT","tokenCount":14208}],"cacheTokensDetails":[{"modality":"TEXT","tokenCount":12158}],"thoughtsTokenCount":595,"serviceTier":"standard"}`

Примітки:
- Вихідні 664 = candidatesTokenCount 69 + thoughtsTokenCount 595: роздуми тарифікуються як вихід.
- cachedContentTokenCount = 12158 уже на першому виклику цього запуску. Припущення: неявний кеш Gemini зберіг той самий префікс із попередніх спроб того ж дня, що завершилися HTTP 503.
- Наступні виклики (gemini-2, gemini-3) і кілька попередніх запусків завершилися HTTP 503 «This model is currently experiencing high demand» — перевантаження моделі на боці Google, не помилка коду чи ключа (countTokens при цьому відповідав).
- $ фактично = 0: безкоштовний рівень Gemini API; $ за прайсом — скільки той самий виклик коштував би за акційною ціною models.ts (оцінка згори, без знижки за кеш).

## 2. Кешування

Префікс: scripts/doctor.ts + scripts/sync-skills.ts + src/models.ts (для Ollama — перші 6000 символів).

| прогін | провайдер | модель | вхідні | кешовані | вихідні | оцінка входу до виклику | похибка % | $ фактично | $ за прайсом models.ts | затримка, мс | дата |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ollama-1 | ollama | qwen3:4b | 2012 | 0 | 64 | — | — | 0.000000 | 0.000000 | 10060 | 2026-10-04 |
| ollama-2 | ollama | qwen3:4b | 2012 | 2011 | 64 | — | — | 0.000000 | 0.000000 | 1686 | 2026-10-04 |

Назва поля кешу: `cache_read_input_tokens` (форма Messages, `/v1/messages`) · сирий usage другого виклику: `{"input_tokens":1,"cache_read_input_tokens":2011,"output_tokens":64}`
Для Ollama: це повторне використання префікса моделі, а не знижка в рахунку.

Спостереження: у сирому usage другого виклику `input_tokens` = 1, бо в Messages-формі кешовані токени до нього не входять; повний вхід 1 + 2011 = 2012 складає `fromMessagesUsage`. Затримка впала з 10 060 мс до 1 686 мс (перший виклик ще й завантажував модель у пам'ять).

## 3. Множник «українська / англійська»

| Провайдер | Модель | Текст (про що, скільки слів) | Токени en | Токени ua | ua / en |
|---|---|---|---|---|---|
| google | gemini-3.8-flash | мій AGENTS.md цього репозиторію | 344 | 417 | 1.21 |
| ollama | qwen3:4b | мій AGENTS.md цього репозиторію (шаблон чату 11 токенів віднято) | 319 | 529 | 1.66 |

Команда: npx tsx --env-file=.env.local scripts/measure-cost.ts lang docs/lab1/cost.md
Тексти, на яких виміряно множник (скрипт читає саме ці два блоки). Український — мій AGENTS.md; англійський переклад зроблено з допомогою Claude (чат) і звірено вручну.

Висновок: той самий зміст українською коштує в 1.21 раза більше токенів у Gemini і в 1.66 раза більше в локальній qwen3:4b — токенізатор малої моделі розбиває кирилицю значно дрібніше.

```ua
# AGENTS.md

Це навчальний проект для роботи з готовими агентами та створення свого агентного циклу.

## Стек

- TypeScript (`strict`), Next.js (App Router), Vitest.
- Node.js 24
- Локальні моделі запускаються через Ollama.

## Команди

- `npm test` — тести (Vitest), без мережі.
- `npm run typecheck` — перевірка типів, без емісії.
- `npm run lint` — лінтер.

## Межі

- `.env` і `.env.local` агент не читає і не редагує: секрети веде людина.
- Тести не ходять у мережу і не викликають платні API.
- `node_modules/` і `.next/` агент не редагує вручну.
- `package-lock.json` агент не змінює вручну.
- `.git/` і `.agent-log/` агент не змінює напряму.

Наступні дії виконуються тільки після мого підтвердження:
- видалення даних або файлів
- платні API-виклики понад погоджений ліміт
- встановлення або видалення залежностей
- `git push`

## Домовленості

- Модель обирається роллю з `src/models.ts` (`MODELS.cheap`), а не рядком-ідентифікатором.
- Ціни й дати зняття моделей звіряються зі сторінкою вендора, а не з пам'яті.
- Повідомлення комітів пишуться у форматі `тип: короткий опис`, наприклад `docs: журнал автономності`.

Завдання вважається готовим, коли `npm run typecheck`, `npm run lint` і `npm test` проходять без помилок.
```

```en
# AGENTS.md

This is a learning project for working with ready-made agents and building your own agent loop.

## Stack

- TypeScript (`strict`), Next.js (App Router), Vitest.
- Node.js 24
- Local models run through Ollama.

## Commands

- `npm test` — tests (Vitest), no network.
- `npm run typecheck` — type checking, no emit.
- `npm run lint` — linter.

## Boundaries

- The agent does not read or edit `.env` and `.env.local`: secrets are managed by a human.
- Tests do not access the network and do not call paid APIs.
- The agent does not edit `node_modules/` and `.next/` manually.
- The agent does not change `package-lock.json` manually.
- The agent does not change `.git/` and `.agent-log/` directly.

The following actions are performed only after my confirmation:
- deleting data or files
- paid API calls beyond the agreed limit
- installing or removing dependencies
- `git push`

## Conventions

- The model is chosen by role from `src/models.ts` (`MODELS.cheap`), not by an identifier string.
- Model prices and retirement dates are checked against the vendor's page, not from memory.
- Commit messages are written in the format `type: short description`, for example `docs: autonomy log`.

A task is considered done when `npm run typecheck`, `npm run lint` and `npm test` pass without errors.
```

## 4. Три прогони (крок 11)