# Підключення MCP-сервера

Сервер: `lab2-corpus` 1.0.0 (`src/mcp/server.ts`, специфікація — [`mcp-spec.md`](mcp-spec.md)), stdio, ревізія 2026-07-28. Обидва боки — 2026-11-09, macOS, Node 24. Журнал, який пише сам сервер: [`traces/mcp-calls.jsonl`](traces/mcp-calls.jsonl).

## Бік 1 — агент кодування
- Який агент і версія: OpenCode 1.18.34, модель головної розмови — Gemini 3.5 Flash Lite (Google AI Studio, безкоштовний рівень).
- Чому саме він: шлях за $0. Платної підписки Claude Code чи Codex у мене немає; OpenCode уже налаштований на кроці 02 (субагенти `.opencode/agents/`), а модель — на безкоштовному рівні Gemini, як і решта Лабораторної 2.
- Де лежить конфігурація: [`opencode.json`](../../opencode.json) у корені репозиторію (закомічений; поруч — `context7` з попередніх кроків).
- Конфігурація дослівно (секретів немає взагалі — серверу ключ не потрібен):
```json
"lab2-corpus": {
  "type": "local",
  "command": ["npx", "tsx", "src/mcp/server.ts"],
  "enabled": true,
  "environment": { "MCP_CLIENT_LABEL": "opencode" },
  "timeout": 15000
}
```
  Ключ — `mcp` (не `mcpServers`), `command` — масив, змінні — `environment`. Робоча тека — корінь репозиторію: OpenCode читає проєктний `opencode.json` лише коли запущений у цьому проєкті, тож відносний `src/mcp/server.ts` резолвиться від кореня; дані сервер і так бере від `import.meta.url`. `timeout` підняла з типових 5 000 до 15 000 мс — це час на `tools/list`, а сервер на старті читає індекс 3,9 МБ і будує BM25.
- Команда: `opencode run "Виклич інструменти MCP-сервера lab2-corpus: 1) fetch_chunk з id korovai#0005; 2) search_corpus з query 'писанка знак перемир'я'; 3) fetch_chunk з id korovai#9999. …"`
- Що викликано (OpenCode іменує інструменти `lab2-corpus_<інструмент>`):

| Інструмент | Аргументи | Що повернулося |
|---|---|---|
| `lab2-corpus_fetch_chunk` | `{"id":"korovai#0005"}` | фрагмент `korovai#0005` (`corpus/korovai.md › Обрядовість`) |
| `lab2-corpus_fetch_chunk` | `{"id":"korovai#9999"}` | `✗ failed` — «фрагмента korovai#9999 немає в індексі» (відмова сервера, `isError`) |
| `lab2-corpus_search_corpus` | `{"query":"писанка знак перемир'я"}` (`topK` — типове 5) | 5 фрагментів; модель процитувала `pysanka#0018` «Писанку за всіх часів дарували на знак перемир'я…» |

- Доказ з боку агента, незалежний від сервера: журнал OpenCode [`.agent-log/opencode.jsonl`](../../.agent-log/opencode.jsonl), рядки 107–108 — `lab2-corpus_fetch_chunk` і `lab2-corpus_search_corpus`, сесія `ses_e403632b…`, `source: opencode`, 10:10:40Z (невдалий виклик із відмовою журнал агента не записав — його видно в транскрипті й у журналі сервера).
- Доказ: транскрипт [`traces/mcp-opencode.txt`](traces/mcp-opencode.txt) + 3 рядки `"source":"opencode"` у `traces/mcp-calls.jsonl` (10:10:40Z: два `fetch_chunk` — `ok` і `refused`, один `search_corpus` — `ok`, `hits: 5`).

## Бік 2 — застосунок
- Де код клієнта: [`scripts/mcp-demo.ts`](../../scripts/mcp-demo.ts) — `@modelcontextprotocol/client` (`Client` + `StdioClientTransport`); процес сервера породжує транспорт.
- Команда запуску: `npx tsx scripts/mcp-demo.ts "чим гості дякували за коровай"` (з будь-якої теки після виправлення нижче).
- Оточення сервера: `getDefaultEnvironment()` + `MCP_CLIENT_LABEL=lab2-app` (+ `OLLAMA_BASE_URL`, лише якщо задано), **не** `...process.env` — інакше серверу дісталися б `GEMINI_API_KEY` і ключі Langfuse застосунку.
- Що викликано: `listTools` (2 інструменти), `search_corpus {query, topK: 3}` → 3 фрагменти з цитатами; `fetch_chunk {id: "korovai#0005"}` → фрагмент; `fetch_chunk {id: "korovai#9999"}` → відмова, `isError: true` (повертається як результат, `await callTool` не кидає виняток).
- Доказ: вивід [`traces/mcp-app.txt`](traces/mcp-app.txt) (з кореня) і [`traces/mcp-app-from-docs-fixed.txt`](traces/mcp-app-from-docs-fixed.txt) (з `docs/`, після виправлення); 6 рядків `"source":"lab2-app"` у `traces/mcp-calls.jsonl` (два прогони × `search_corpus` ok, `fetch_chunk` ok, `fetch_chunk` refused).

Підсумок журналу (`mcp-calls.jsonl`, згруповано за source / tool / result):

| source | search_corpus ok | fetch_chunk ok | fetch_chunk refused |
|---|---|---|---|
| `opencode` | 1 | 1 | 1 |
| `lab2-app` | 2 | 2 | 2 |
| `inspector-smoke` (крок 08) | 1 | — | 1 |
| `unknown` (крок 08, перший smoke без `-e`) | 1 | — | 1 |

## Що зламалося з першого разу
| Що саме | На якому боці | Причина | Що змінила в сервері чи конфігурації |
|---|---|---|---|
| `ERR_MODULE_NOT_FOUND …/docs/src/mcp/server.ts`, клієнт не стартує ([`traces/mcp-app-from-docs.txt`](traces/mcp-app-from-docs.txt)) | застосунок | перша версія `mcp-demo.ts` передавала транспорту відносний `src/mcp/server.ts`; він резолвиться від робочої теки, а я запустила скрипт з `docs/` | клієнт бере корінь від `import.meta.url`: `args: ['tsx', resolve(ROOT, 'src/mcp/server.ts')]`, `cwd: ROOT`; повтор з `docs/` — зелений |
| у журналі `source: "unknown"` | Inspector (smoke, крок 08) | Inspector не передає серверу змінні з терміналу; `export MCP_CLIENT_LABEL=…` не дійшов | мітка через `--cli -e MCP_CLIENT_LABEL=inspector-smoke`; старі рядки лишено в журналі як є |
| тест «немає `console.log`» упав хибно | CI / тести (крок 08) | регулярний вираз знайшов слово в коментарі `server.ts` | тест шукає виклик `console.log(` |
| OpenCode назвав `korovai#0005` фрагментом про «одяг / символіку» | агент | так стисла відповідь модель; сервер повернув правильний текст (поділ короваю) | нічого — це якість підсумку моделі, не сервера; для доказу беру журнал сервера, а не переказ моделі |
| пошук «чим гості дякували за коровай» не повертає `korovai#0005`, хоч там «молоді ділилися з гостями» | обидва | поведінка гібридного пошуку кроку 05 на іншому формулюванні, ніж q-20 | нічого в сервері; той самий клас помилки, що q-17 / q-19 в `eval-report.md` |

Підключення OpenCode спрацювало з першого запуску.

## Чим відрізняються два боки
- Робоча тека і оточення процесу: OpenCode запускає сервер з кореня проєкту (там лежить `opencode.json`) і передає `environment` з конфігурації; мій клієнт — з теки, де я стою, і з `getDefaultEnvironment()` (без ключів застосунку). Саме різниця робочих тек зламала другий бік.
- Таймаути клієнта проти таймауту сервера: сервер — 10 с на обробник (`LIMITS.timeoutMs`); OpenCode — `timeout` 15 000 мс на `tools/list` (типово 5 000); `@modelcontextprotocol/client` — типовий таймаут запиту SDK, у коді не змінювала; для порівняння з методички — Codex CLI `tool_timeout_sec` 60 с, Gemini CLI `timeout` 600 000 мс. Серверний таймаут найкоротший, тож користувач бачить причину відмови сервера, а не таймаут клієнта.
- Що з цього я зафіксувала в `mcp-spec.md` як вимогу: клієнт задає робочою текою корінь репозиторію або передає абсолютний шлях до `src/mcp/server.ts`; оточення серверу — лише мітка викликача й адреса Ollama, без ключів (рядок «Історії версій» 2026-11-09, v1.1).

## Секрети
- Жодного значення ключа в закомічених конфігураціях: `grep -nE 'AIza|sk-|Bearer|KEY|SECRET|TOKEN' opencode.json scripts/mcp-demo.ts src/mcp/*.ts` → єдиний збіг — коментар у `mcp-demo.ts`, що пояснює, чому НЕ передаємо `process.env`. Серверу ключ не потрібен узагалі.
- Де насправді лежать ключі: `.env.local` (у `.gitignore`); у репозиторії — [`.env.example`](../../.env.example) без значень; `git ls-files | grep .env` → лише `.env.example`.
