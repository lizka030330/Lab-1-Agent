# Зміцнення деплою

- Дата: 2026-11-25 · застосунок: https://lab-1-agent-git-lab4-step-00-efremka.vercel.app (preview гілки `lab4/step-00`) · платформа: Vercel Hobby
- Комміт, на якому все перевірено: `a04f069` (`/api/health` повертає саме його — див. кожен файл `probe-*.txt`)
- Shareable Link для викладача: https://lab-1-agent-git-lab4-step-00-efremka.vercel.app/?_vercel_share=O9YVdPYixNLKxNlSFUPUOcF65BVdtiSA (створено 2026-11-25 ~23:30 через панель Vercel; Vercel попереджає, що воно обходить Deployment Protection — тому від витрат через нього захищають вимикач і ліміти з розділів 4–5; термін дії посилання в інтерфейсі не показано)   (захист доступу: Vercel Authentication на preview)

Код кроку: `src/flags.ts`, `src/budget.ts`, `src/guard.ts`, `src/telemetry.ts`, `src/http.ts`, `src/otel/langfuse.ts`, `instrumentation.node.ts`, маршрути `app/api/{agent,multimodal,health,ready}/route.ts`, тести `tests/hardening/` (23 нові; `npm test` 259/259, `tsc` і `eslint` — 0 помилок). Скрипти доказів: `scripts/hardening/probe.sh`, `scripts/hardening/secret-history.sh`.

## 0. Чеклист: пункт → доказ
| № | Пункт | Стан | Доказ |
|---|---|---|---|
| 1 | Телеметрія увімкнена типово; спани доїжджають із ЗАДЕПЛОЄНОГО застосунку | ✅ | [`probe-baseline.txt`](traces/hardening/probe-baseline.txt) (21:10 UTC) → та сама траса в Langfuse: [`langfuse-trace-tree.png`](traces/hardening/langfuse-trace-tree.png), [`langfuse-trace-list.png`](traces/hardening/langfuse-trace-list.png) |
| 2 | trace_id кожного прогону стоїть у журналі; functionId містить id задачі | ✅ | `trace_id` і `task_id` у кожній відповіді й у `probe-*.txt`; `8b57d088184d107bcd88c97f1ed9a932` із журналу відкриває трасу з `invoke_agent` (знімок). Харнес Лаб. 3 пише `trace_id` у `run.json` з кроку 06 Лаб. 3 (`scripts/harness/run-queue.ts`) |
| 3 | recordInputs / recordOutputs вимкнені — вмісту запитів у трасах немає | ✅ | `src/telemetry.ts` (`aiTelemetry`); Input/Output = `undefined` у трасі (знімок); у списку трас колонка Input «—» для нових спанів |
| 4 | .env у .gitignore; .env.example лише з іменами | ✅ | [`.gitignore`](../../.gitignore) рядки `.env`, `.env.local`, `.env.*.local`; [`.env.example`](../../.env.example) — порожні значення, нові `GLOBAL_CONFIG`, `UPSTASH_REDIS_REST_*` |
| 5 | Ключі на платформі — тип Secret (Sensitive) | ✅ з винятком | [`env-google.png`](traces/hardening/env-google.png), [`env-langfuse.png`](traces/hardening/env-langfuse.png), [`env-kv.png`](traces/hardening/env-kv.png); виняток і «різні значення за середовищами» — розділ 3 |
| 6 | Історія git перевірена на секрети (три команди, вивід збережено) | ✅ | [`secret-history.txt`](traces/secret-history.txt) — 225 коммітів, 160 refs, 3 ключі: нічого не знайдено |
| 7 | Вимикач гасить агента БЕЗ деплою; недосяжне сховище = вимкнено | ✅ | [`probe-flag-off.txt`](traces/hardening/probe-flag-off.txt): той самий `commit` `a04f069`, `/api/ready` 503 `agentEnabled:false`, запит 503 `agent_disabled`; «недосяжне = вимкнено» — тести `tests/hardening/flags.test.ts` |
| 8 | /api/health і /api/ready відповідають і НЕ викликають модель | ✅ | `probe-*.txt`; тест `tests/hardening/routes.test.ts` (ready без сховищ — 503 і жодного `fetch`) |
| 9 | Правило обмеження частоти створене (дія: Log) | ✅ | [`waf-rule-config.png`](traces/hardening/waf-rule-config.png), [`waf-rule-list.png`](traces/hardening/waf-rule-list.png) |
| 10 | Стеля витрат на рівні застосунку СПРАЦЮВАЛА — доказ збережено | ✅ | [`probe-cap.txt`](traces/hardening/probe-cap.txt) (21:18 UTC): 200 → 429 `budget_exhausted` / `output_tokens_per_day`, `Retry-After` |
| 11 | Доступ до демонстрації закритий, посилання для викладача видане | ✅ | Vercel Authentication (без секрету скрипт отримує сторінку входу — крок 05, прогін 22:22); Shareable Link — угорі файлу |
| 12 | Рішення щодо персональних даних записане | ✅ | розділ 6 |

## 1. Межі платформи і наслідки для коду
| Межа | Значення (Hobby) | Що через це змінено в коді |
|---|---|---|
| тривалість функції | 300 с (типова = максимальна; на межі 504 `FUNCTION_INVOCATION_TIMEOUT`) | маршрути моделі мають `maxDuration = 60` — запас ×5; агентний цикл обмежено `isStepCount(3)`, гілки кроку 03 — бюджетом `maxMs` |
| тіло запиту / відповіді | 4,5 МБ (на межі 413 `FUNCTION_PAYLOAD_TOO_LARGE`) | `MAX_BYTES = 3 000 000` перевіряється в браузері й на сервері тією самою константою (крок 05); великі файли через функцію не пропускаємо |
| памʼять / vCPU | 2 ГБ / 1 | файл тримаємо в памʼяті лише один раз (`Uint8Array`), без копій у base64 на сервері до виклику SDK |
| регіон | один, `iad1` | сховище лічильників створено в Washington, D.C. (`iad1`) — поруч із функцією, бо кожен запит робить 2–3 звернення до нього |
| журнали виконання | 1 година, Log Drains недоступні | докази пишуться у файли того самого дня (`probe-*.txt`), а телеметрія — у Langfuse, а не в журнали Vercel |

## 2. Телеметрія
- Пакети й версії (з `node_modules/*/package.json`): `ai` 7.0.127, `@ai-sdk/otel` 1.0.127 (тепер пряма залежність), `@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-node` 0.222.0, `@opentelemetry/exporter-trace-otlp-http` 0.222.0, `@langfuse/otel` 5.11.1. Версії нижчі за ті, що в методичці (1.10.0 / 0.300.0) — стоять ті, що були в репозиторії з Лаб. 1; не оновлювала, щоб не змінювати дві речі одночасно.
- Бекенд: Langfuse Cloud (EU), `LANGFUSE_BASE_URL`; експорт — `LangfuseSpanProcessor({ exportMode: 'immediate' })`, усередині якого `OTLPTraceExporter` (OTLP/HTTP, не gRPC) на `<base>/api/public/otel/v1/traces` з Basic-авторизацією. **Заголовок `x-langfuse-ingestion-version=4` цей процесор не ставить** (перевірено в `node_modules/@langfuse/otel/dist/index.mjs`); у режимі `immediate` спани все одно зʼявились у Langfuse за секунди — видно на знімку списку.
- Реєстрація: `instrumentation.ts` → `instrumentation.node.ts`: `new NodeSDK({ spanProcessors: [langfuseSpanProcessor] }).start()` і `registerTelemetry(new OpenTelemetry())`. Оскільки маршрути Next.js — окремі бандли з окремою копією `ai`, інтеграція ще й передається в кожен виклик (`telemetry.integrations` у `src/telemetry.ts`) — це помилка, знайдена ще в Лаб. 1 (крок 10).
- Корінний спан: `tracer.startActiveSpan('invoke_workflow <workflow>', …)` з `@opentelemetry/api`, атрибути `gen_ai.workflow.name` і власний `lab4.task_id`; `span.spanContext().traceId` → поле `trace_id` відповіді (нулі → `null`, а не фальшивий id). Типовий фільтр `LangfuseSpanProcessor` пропускає лише спани AI SDK — для корінного спана додано `shouldExportSpan` зі scope `lab4-app`.
- Вивантаження перед завершенням функції: `after(async () => { await langfuseSpanProcessor.forceFlush(); })` — реєструється на початку обробника, тож спрацьовує і після помилки.
- Траса із задеплоєного застосунку: `trace_id` `8b57d088184d107bcd88c97f1ed9a932` (запит #2 у `probe-baseline.txt`) → дерево `invoke_workflow lab4-multimodal` → `invoke_agent gemini-3.8-flash` → `step 1` → `chat gemini-3.8-flash`; 490 токенів = 149 + 341, як у відповіді.
- Як знайти прогін: `gen_ai.agent.name` = `task-<task_id>` (functionId), або `trace_id` із журналу прогону.
- **Знахідка:** у списку трас лишились спани кроку 05 (22:26, `ai.generateSpeech`) з непорожнім Input — текст для озвучення тоді потрапляв у трасу. Тепер `generateSpeech` і `transcribe` теж отримують `aiTelemetry()` з `recordInputs: false`.

## 3. Секрети
| Змінна | Тип на Vercel | Середовища | Звідки |
|---|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Sensitive (замок) | Production, Preview | вручну |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Sensitive | Production, Preview | вручну (Лаб. 1) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_*` | Sensitive | Production, Preview | інтеграція Upstash, префікс `KV` |
| `GLOBAL_CONFIG` | **звичайна (Config)** | усі | інтеграція Global Config |

- `GLOBAL_CONFIG` лишила звичайною свідомо: у ній токен **лише на читання** конфігураційного сховища — ним можна дізнатися `agentEnabled`, але не змінити його. Sensitive Vercel не дозволяє для Development (перевірила на Upstash: «Sensitive variables can't target Development»), тому Upstash підключено лише до Production і Preview.
- «Різні значення за середовищами» — **не виконано**: Production і Preview мають той самий ключ Gemini і ті самі сховища. Чесний ризик: тест на preview витрачає ту саму квоту й ті самі лічильники, що й production.
- Перевірка історії ([`secret-history.txt`](traces/secret-history.txt), 2026-11-25 20:59 UTC): (1) файли ключів в історії — лише `.env.example`; (2)–(3) фрагменти ключів `gemini` (13 симв.), `langfuse-sk` (14), `upstash` (12) — **нічого не знайдено** в жодному з 225 коммітів 160 refs. Секрет обходу Vercel не перевіряла. Фрагменти вводились через `read -s` і у файл не пишуться.
- Важливе спостереження: мій ключ Gemini нового формату (`AQ.`), а не `AIza…`. Пошук за шаблоном `AIza[0-9A-Za-z_-]{35}`, яким агент попередньо проганяв історію, такий ключ **не впіймав би** — тому перевірка саме за фрагментом власного ключа обовʼязкова.
- Чи була втеча: в історію git — ні. Під час цієї сесії я помилково вставила перші 12 символів ключа Gemini в чат з агентом (а не в термінал); у файли й комміти вони не потрапили. 12 символів без решти ключа не дають доступу, тому ключ не відкликала — свідоме рішення.
- Що НЕ прикриває маскування логів: маскуються лише значення Secret від 32 символів; збірка в нас ключів не друкує, але це не перевірка, а відсутність випадку. Сповіщення secret scanning GitHub для публічного репозиторію працюють лише ПІСЛЯ пушу.

## 4. Запобіжники
- Вимикач: Global Config `lab4-flags`, ключ `agentEnabled`; читання на кожен запит — `GET https://global-config.vercel.com/<id>/item/agentEnabled` з `Authorization: Bearer <read token>` (форма з документації Vercel «Using Global Config»; пакет-клієнт не ставила — це один `fetch`). Вмикає лише явне `true`; збій, тайм-аут 1,5 с, відсутнє підключення → вимкнено. Доказ: `probe-flag-off.txt` — без деплою, `commit` той самий.
- Відкат: Instant Rollback на Hobby — лише на один деплой назад; канарки немає. Тому вимикач — перший засіб, відкат — другий.
- `/api/health`: «процес живий» + `commit` (`VERCEL_GIT_COMMIT_SHA`). `/api/ready`: ключ моделі є, сховище прапорця **досяжне** (окрема `probeFlagStore`, яка не глушить помилку), прапорець увімкнено, сховище лічильників є, токени за день не вичерпано. Жодна з них не викликає модель.

## 5. Ліміти
- **Правило частоти (шар 1, платформа):** `lab4-rate-limit` — `Request Path` starts with `/api/`, Fixed Window **60 с**, **30** запитів, ключ **IP Address**, дія **Log** (нічого не блокує, лише пише). Створено й опубліковано 2026-11-25 ~23:27; на Hobby — одне таке правило на проєкт.
- **Лічильник у коді (шар 2):** Upstash Redis `lab4-counters` (Free: 500 000 команд на місяць), `iad1`. Чому не памʼять інстанса: кожен інстанс рахував би своє. Чому не Global Config: там 100 записів на місяць. Атомарність: `POST <url>/multi-exec` з `[["INCRBY", key, n], ["EXPIRE", key, ttl], …]` — транзакція MULTI/EXEC Upstash REST; `admit()` збільшує лічильник і порівнює **нове** значення, тож запити в польоті не проскакують межу запитів. Один запит до моделі ≈ 10–15 команд Redis.
- Що рахується: запити за день і за хвилину, окремо TTS і STT за день і за хвилину, вхідні й вихідні токени за день (`totalUsage`, `?? 0`). TTS/STT не звітують `LanguageModelUsage` — тому для них ліміт у запитах, а не в токенах.
- **Стеля витрат:**

| Межа | Моя | Квота з AI Studio (Tier 1, переписано 25.11.2026 22:29) |
|---|---|---|
| запитів за день / хвилину | 300 / 20 | Flash: 10K RPD / 1K RPM |
| вхідних токенів за день | 1 000 000 | Flash: 2M TPM |
| вихідних токенів за день | 100 000 | — |
| TTS за день / хвилину | 50 / 5 | 100 RPD / 10 RPM |
| STT за день / хвилину | 50 / 5 | 100 RPD / 10 RPM |

  Межі можна звузити без деплою — ключ `limits` у тому самому Global Config (приймаються лише відомі невідʼємні числа).
- **Властивість, яку не замовчую:** токени перевіряються ДО виклику, а обліковуються ПІСЛЯ, тож перевищення можливе на «запити в польоті × токени одного запиту». У доказі нижче межа 700 перевищена на 306.
- **Помилка, яку впіймали тести:** у першій версії `guard()` обидві перевірки обчислювались одразу (`[await checkTokens(), await admit()]`), тож спроба з уже вичерпаними токенами все одно збільшувала лічильник запитів. Тест `guard.test.ts` упав, виправлено на послідовну перевірку.
- **ДОКАЗ СПРАЦЮВАННЯ** ([`probe-cap.txt`](traces/hardening/probe-cap.txt), 2026-11-25 21:18 UTC, комміт `a04f069`, межу `outputTokensPerDay: 700` виставлено в Global Config без деплою; до прогону за день було 658 вихідних):
  - #1 → **200**, +348 вихідних (разом 1006);
  - #2 → **429** `budget_exhausted` / `output_tokens_per_day`, `Retry-After: 9695` (≈ 2 год 42 хв — до 00:00 UTC);
  - #3 → **429** те саме. Модель у #2 і #3 не викликалась (немає `task_id` і `trace_id`).

  Після доказу `limits` прибрано, прапорець — `{ "agentEnabled": true }`.

## 6. Дані на безкоштовному рівні
- Умова: «Do not submit sensitive, confidential, or personal information to the Unpaid Services»; на безкоштовному рівні вхід і вихід можуть читати люди-рецензенти.
- Мій ключ — **платний Tier 1**, тож ця умова до мене формально не застосовується. Рішення все одно таке саме, бо проєкт навчальний і демонстрація відкривається за посиланням: **продакшн без персональних даних**.
- Що заборонено в застосунку: завантажувати власні чи чужі документи з персональними даними (про це написано на сторінці `/multimodal`); у трасах — жодного вмісту запитів, файлів чи голосу (`recordInputs/recordOutputs: false`); у репозиторії — жодних знімків з моєю поштою, іменем чи списком чатів (знімки обрізані до вікна сервісу; знімок кроку 05 з бічною панеллю обрізано окремим коммітом `2c14607`, попередня версія лишається в історії — там лише імʼя й назви чатів, без ключів).
- Що натомість тестові дані: файли `fixtures/multimodal/` згенеровані скриптом (`make_fixtures.py`) — вигаданий договір «47-К/2026»; текстові перевірки кроку 06 — питання «Скільки буде два плюс два?» без файлу. Відповідь на нього — «не знаю», і це правильно: промпт велить відповідати лише за вмістом файлу.
