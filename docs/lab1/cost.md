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

Той самий вхід для всіх трьох: `scripts/measure-loop.ts` — однакові системний промпт, задача `/api/health`, інструменти `list_files` і `read_file`, `maxSteps` 12, бюджет 150 000 токенів, схема виходу `Proposal`.

| прогін | провайдер | модель | вхідні | кешовані | вихідні | оцінка входу до виклику | похибка % | $ фактично | $ за прайсом models.ts | затримка, мс | дата |
|---|---|---|---|---|---|---|---|---|---|---|---|
| хмара | google · Gemini API free tier (Chat Completions) | gemini-3.5-flash-lite | 11887 | 0 | 224 | — | — | 0.000000 | 0.004126 | 211738 | 2026-10-05 |
| шлюз | OpenRouter (Chat Completions) | nvidia/nemotron-3.5-lightning:free | 9613 | 0 | 2373 | — | — | 0.000000 | 0.000000 (шлюзу немає в models.ts; :free-модель — ціна 0 зі сторінки моделі на OpenRouter) | 99600 | 2026-10-04 |
| локально | ollama (Messages) | qwen3:4b-instruct | 2669 | 1910 | 260 | — | — | 0.000000 | 0.000000 | 11374 | 2026-10-04 |

Команди:
- `GEMINI_MODEL=gemini-3.5-flash-lite npx tsx --env-file=.env.local scripts/measure-loop.ts gemini 1`
- `npx tsx --env-file=.env.local scripts/measure-loop.ts openrouter 1` (OPENROUTER_MODEL=nvidia/nemotron-3.5-lightning:free)
- `OLLAMA_MODEL=qwen3:4b-instruct npx tsx --env-file=.env.local scripts/measure-loop.ts ollama-messages 1`

Сесії в `.agent-log/agent-loop.jsonl`: хмара — `agent-loop-gemini-2026-10-05T11-43-45-343Z` (`max-steps`, 12 кроків); шлюз — `agent-loop-openrouter-2026-10-04T19-29-53-214Z` (`done`, 9 кроків); локально — `agent-loop-ollama-messages-2026-10-04T19-33-41-002Z` (`done`, 4 кроки).

Примітки:
- Хмара: 04.10 — денна квота безкоштовного рівня `gemini-3.8-flash` (20 запитів) вичерпана, HTTP 429; 05.10 — три спроби поспіль на `gemini-3.8-flash` завершилися HTTP 503 «high demand» (перевантаження на боці Google; ключ перевірено прямим запитом до `gemini-3.5-flash-lite` — працює). Тому хмарний прогін зроблено на `gemini-3.5-flash-lite` (та сама хмара Google, ціни $0.30/$2.50 за 1M з `src/models.ts`); модель обирається змінною `GEMINI_MODEL` у скрипті, решту входу не змінено.
- Хмара зупинилась на `max-steps`: модель робила один виклик інструмента за крок — 6 × `list_files` (`.`, `tests`, `src`, `app`, `app/api`, `app/api/health`), потім 6 × `read_file` (тест, контракт, наявний `route.ts`, `package.json`, `tsconfig.json` і вдруге `src/health.ts`) — і не встигла видати фінальний JSON. Звідси мало вихідних токенів (224) і найбільший вхід: кожен крок пересилає всю історію з прочитаними файлами. Ліміт кроків спрацював як запобіжник; `maxSteps` для неї не підвищувала, щоб вхід трьох прогонів лишився однаковим.
- Шлюз: перші спроби з `google/gemma-4-31b-it:free` (провайдер Google AI Studio) і `qwen/qwen3.8-27b:free` (провайдер ModelRun) завершилися HTTP 429 «temporarily rate-limited upstream», `limit_source: upstream_provider_shared_pool` — безкоштовні моделі шлюзу ділять спільний ліміт з усіма користувачами. `qwen3.8-27b` до обриву встигла зробити 10 викликів інструментів (session `agent-loop-openrouter-2026-10-04T19-28-18-409Z`). Скрипт зупинявся на першій помилці HTTP.
- Кеш: локальна Ollama повторно використала 1910 з 2669 вхідних токенів (префікс історії між кроками); Gemini (через OpenAI-сумісний ендпоінт) і OpenRouter кешованих токенів не повернули (0).
- Вартість: лише хмара має ненульову ціну за прайсом — $0.004126 за 11 887 вхідних і 224 вихідних токени; на безкоштовних рівнях фактичний рахунок усіх трьох — $0.
- Якість пропозицій на тому самому вході різна: модель шлюзу запропонувала правильний `app/api/health/route.ts` (відносний `import type`, `export const dynamic = 'force-dynamic'`, тип відповіді з контракту), але повернула й контрактні файли `tests/health.test.ts` і `src/health.ts` (вміст без змін); локальна модель повернула лише незмінений `src/health.ts`, без маршруту — схему пройшла, задачу не розв'язала; хмарна (flash-lite) відповіді не дала.