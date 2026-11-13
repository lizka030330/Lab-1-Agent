# Фабрика задач

- Дата: 2026-11-13 · репозиторій: https://github.com/lizka030330/Lab-1-Agent
- Шлях агента: **OpenCode 1.18.34**, модель **`google/gemini-3.6-flash`** (Google AI Studio, безкоштовний рівень). Перші спроби — **OpenCode + Ollama** локально (`qwen3:8b`, `qwen2.5-coder:14b`), див. розділ 7.
- Чому саме цей: платної підписки Claude Code / Codex у мене немає; OpenCode уже налаштований з Лаб. 2. Почала з повністю безкоштовного локального шляху (Mac M1 Pro, 16 ГБ RAM), але обидві локальні моделі провалили 4 з 4 прогонів. Gemini 3.6 Flash — перша модель, що пройшла acceptance; ціна — **добова квота 20 запитів** на безкоштовному рівні (≈ 2 задачі на день). Верифікатор кроку 02 лишається на **іншій** моделі — `gemini-3.5-flash-lite` (відкалібрована в Лаб. 2).
- Режим дозволів: окремий агент `harness` ([`.opencode/agents/harness.md`](../../.opencode/agents/harness.md)), без `--auto`. Дослівно:
  ```yaml
  permission:
    edit: allow
    webfetch: deny
    bash:
      "*": deny
      "npm test*": allow
      "npm run typecheck*": allow
      "npm run lint*": allow
      "git diff*": allow
      "git status*": allow
  tools: { "lab2-corpus_*": false, "context7_*": false }   # MCP-сервери агентові фабрики не потрібні
  ```
  Це аналог `--permission-mode dontAsk` + `--allowedTools` для OpenCode: дозволено рівно перелічене, решта — `deny`. `opencode run --auto` («auto-approve permissions that are not explicitly denied (dangerous!)» — `opencode run --help`) не використовується: це обхід дозволів. Глобальна заборона читати й редагувати `.env*` з `opencode.json` діє й тут.
- Ізоляція: **git worktree** на кожен прогін, від поточного коміту (`HEAD`), на окремій гілці `harness/<id>-<мітка>`. Команди (у `scripts/harness/run-queue.ts`):
  ```
  git worktree add -b harness/<id>-<мітка> ../harness-runs/<id>-<мітка> HEAD
  ln -s <корінь>/node_modules ../harness-runs/<id>-<мітка>/node_modules      # залежності — посиланням
  git worktree remove ../harness-runs/<id>-<мітка> --force                   # після прогону, завжди (finally)
  ```
  Перед прогоном скрипт перевіряє, що основний checkout чистий; після — друкує його стан. Усі 11 прогонів 13.11: «основний checkout: чистий (крім нових docs/lab3/runs/)».

## 1. Форма задачі
| Поле | Тип | Що означає |
|---|---|---|
| `id` | рядок | `t-01`…`t-07`: імʼя теки прогону, частина назви гілки, рядок у журналі; не змінюється |
| `input` | рядок | завдання агентові дослівно, одним абзацом: що зробити, у яких файлах, чого не чіпати |
| `acceptance` | масив рядків | команди, що мають завершитись кодом 0: перевірка наявності (`test -f`, `grep -q`), `npm run typecheck`, `npm test -- <файл>`, `npm run lint` |
| `budget` | обʼєкт | `max_turns` (ціле), `max_usd` (0 — безкоштовний рівень), `timeout_s` (ціле) |
| `files` | масив рядків | файли, яких задача торкається (для довідки й верифікатора кроку 02) |

Черга: [`docs/lab3/tasks.jsonl`](tasks.jsonl), задач **7**, у кожної 4 команди приймання. Задачі — з моєї роботи Лаб. 1–2: `median` і `precisionAtK` у `src/metrics.ts` з тестами; тести `tokenize` (BM25), меж схеми MCP-сервера, `errorPct`; `citedDocIds` у `src/rag/cite.ts`; розділ README. Кожна задача має перевірку «зроблено саме це» (`grep`/`test -f`), щоб агент, який нічого не зробив, не пройшов acceptance на вже зелених тестах.

## 2. Виклик агента
```
opencode run "<input задачі>" -m google/gemini-3.6-flash --format json --agent harness --dir <тека прогону> --print-logs --log-level INFO
```
Кожен прапорець — з `opencode run --help` (1.18.34): `-m provider/model`, `--format json` («raw JSON events»), `--agent`, `--dir`, `--print-logs`, `--log-level`. Бюджетних прапорців у OpenCode немає: `max_turns` і `max_usd` записані в задачі, але **не застосовуються** агентом; бюджет тримає таймаут процесу (`timeout_s`, убивство `SIGKILL`) і квота провайдера. Модель міняється змінною `HARNESS_MODEL`, таймаут можна лише скоротити змінною `HARNESS_MAX_TIMEOUT_S` (для діагностики).

## 3. Де лежать артефакти
`runs/<id>-<мітка>/` — `patch.diff`, `output.txt` (JSON-події OpenCode), `agent.log` (stderr: журнал OpenCode), `run.json`. Сира `runs/` у `.gitignore`.
У репозиторій іде копія кожного прогону: [`docs/lab3/runs/`](runs/) — **усі 11 прогонів 13.11**, зокрема невдалі: саме вони пояснюють вибір моделі (розділ 7). `patch.diff` не містить `.agent-log/`: хук журналу OpenCode дописує його в кожному прогоні, і перший прогін приніс його в артефакт поруч із тестом — виключено в `runTask` (`git add -A -- . ':(exclude).agent-log'`).

## 4. Журнал прогону
| Поле | Звідки значення |
|---|---|
| `task_id` | з черги |
| `agent_path` | `opencode+<модель>` |
| `artifact_dir` | шлях цієї ж теки — звʼязок журналу з артефактом |
| `started_at` / `ended_at` / `duration_s` | виконавець |
| `exit_status` | `timeout` — процес убив таймаут; `ok` — код 0; `budget_or_turns` — ненульовий код і в виводі рядок межі (`Budget limit reached`, `max turns/steps`, `exceeded your current quota` — дослівно з 429 Gemini 13.11); інакше `agent_failed` |
| `acceptance` / `acceptance_passed` | коди виходу команд приймання, виконаних у дереві прогону |
| `session_id` | поле `sessionID` подій OpenCode (`ses_…`) |
| `input_tokens` / `output_tokens` | сума `part.tokens.input` / `part.tokens.output` подій `step_finish` |
| `cost_usd_estimate` | сума `part.cost` подій `step_finish` — **клієнтська оцінка OpenCode за прайсом**, не рахунок; фактично $0 (безкоштовний рівень); для Ollama — 0 |
| `trace_id` | `null` до кроку 06 |
| `gates` | `{}` до кроку 01 |

Назви полів зчитано з першого прогону (`t-02-1794564482289/output.txt`): `{"type":"step_finish","sessionID":"ses_…","part":{"tokens":{"total":…,"input":…,"output":…,"reasoning":0,"cache":{…}},"cost":0}}`.

## 5. Як перезапустити одну задачу
```
npx tsx scripts/harness/run-queue.ts docs/lab3/tasks.jsonl --id t-02 --no-push
```
Кожен запуск — нова тека `<id>-<мітка часу>` і нова гілка, попередній прогін не перезаписується. Без `--no-push` гілка з комітом агента відправляється в `origin` (для брам кроку 01). Усі прогони задачі: `ls -d docs/lab3/runs/t-02-*`.

## 6. Що перевірено без мережі
[`tests/harness/run-task.test.ts`](../../tests/harness/run-task.test.ts), 6 тестів, підставний агент замість OpenCode (ні мережі, ні ключів, ні worktree):
- журнал і всі чотири файли артефакту пишуться на успішному прогоні, `run.json.artifact_dir` вказує на свою теку;
- журнал пишеться, коли агент упав (код 1) і навіть коли сам runner кинув виняток (`spawn … ENOENT`);
- вичерпаний бюджет (`Budget limit reached`, квота Gemini) і таймаут розрізняються з падінням;
- агент «упорався» в нуль ходів: журнал є, `patch.diff` порожній, acceptance вирішує;
- непарсибельний вивід дає `null`, а не падіння; JSON-події OpenCode читаються в токени.

## 7. Прогони 13.11 і що вони показали
| Час (UTC) | Прогін | Модель | exit_status | с | acceptance | токени вх. / вих. |
|---|---|---|---|---|---|---|
| 10:08 | t-02-1794564482289 | ollama/qwen3-8b-16k | ok | 181,1 | fail | 6 544 / 1 743 |
| 10:13 | t-02-1794564828130 | ollama/qwen3-8b-16k | ok | 160,6 | fail | 6 688 / 1 702 |
| 10:24 | t-01-1794565498582 | ollama/qwen3-8b-16k | ok | 166,9 | fail | 6 798 / 1 338 |
| 10:51 | t-02-1794567107015 | ollama/qwen2.5-coder-14b-12k | ok | 107,1 | fail | 6 257 / 260 |
| 11:13 | t-02-1794568421600 | google/gemini-2.5-flash | agent_failed | 10,8 | fail | — |
| 11:57 | t-02-1794571047163 | google/gemini-3.8-flash | timeout | 182,4 | fail | — |
| 12:05 | t-02-1794571544688 | google/gemini-3.6-flash | ok | 51,1 | **pass** | 45 083 / 1 870 |
| 12:08 | t-01-1794571697367 | google/gemini-3.6-flash | agent_failed* | 288,2 | **pass** | 42 333 / 1 738 |
| 12:13 | t-02-1794571986042 | google/gemini-3.6-flash | agent_failed* | 86,7 | fail | 6 196 / 62 |
| 12:14 | t-03-1794572073223 | google/gemini-3.6-flash | agent_failed* | 77,7 | fail | — |
| 12:15 | t-04-1794572151309 | google/gemini-3.6-flash | agent_failed* | 82,2 | fail | — |

\* вичерпана добова квота (429, «limit: 20 … per day»); записано як `agent_failed`, бо розпізнавання квоти додано після цих прогонів — нові прогони з тим самим рядком дають `budget_or_turns`.

Що показали:
- **qwen3:8b** (3 прогони): жодного разу не запустила перевірку; в одному прогоні написала у відповіді «Перевірки пройшли успішно» з вигаданим виводом `npm test`, не викликавши жодної команди; в іншому вставила `median` всередину наявної функції `mean`. Acceptance спіймав усе.
- **qwen2.5-coder:14b**: надрукувала виклик інструмента `write` текстом замість виклику — OpenCode не виконав його, змінено 0 файлів.
- **gemini-2.5-flash**: 404 «no longer available to new users».
- **gemini-3.8-flash**: «high demand», OpenCode ~2 хв мовчки повторював запит; виконавець висів 40 хв, бо таймаут слав `SIGINT`, на який OpenCode не завершується → тепер `SIGKILL` (крок 03).
- **gemini-3.6-flash**: читає код перед зміною, сам запускає `typecheck` і тести, звітує чесно — 2 з 2 задач, на які вистачило квоти, пройшли acceptance; далі — 429 добової квоти на кожній задачі.
