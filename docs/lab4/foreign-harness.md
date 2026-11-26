# Харнес Лаб. 3 по чужому коду (брама)

**Що доведено:** той самий виконавець Лабораторної 3 (`scripts/harness/run-task.ts`: OpenCode → брами-команди приймання → класифікація виходу → журнал `run.json`) прогнав задачу на форку чужого проєкту `lizka030330/path-to-regexp`, брами відпрацювали, верифікатор іншої родини дав вердикт.

| | |
|---|---|
| Чужий репозиторій | https://github.com/lizka030330/path-to-regexp @ `903a4df` (дерево прогону — `git worktree` від цього SHA) |
| Задача | [`foreign-tasks.jsonl`](foreign-tasks.jsonl) `f-01`: додати однорядковий JSDoc над `function tokensToFunction(` у `src/index.ts`, нічого більше не змінюючи |
| Брами (команди приймання) | JSDoc рядком вище; змінено **лише** `src/index.ts`; тести, `package.json`, lock — не змінені; з `src/index.ts` нічого не видалено; `npm run build && npm test` проєкту |
| Агент | OpenCode, `google/gemini-3.6-flash` (модель харнеса Лаб. 3), агент `harness` з [`opencode-harness-foreign.json`](opencode-harness-foreign.json) через `OPENCODE_CONFIG` — форк заради харнеса не змінювався |
| Дозволи агента | `edit`: `"*": deny`, `src/index.ts`: allow, `*.spec.ts` / `package*.json` / `stryker.config.mjs`: deny; `bash`: `"*": deny`, дозволено лише `npm run build*`, `npm test*`, `git diff*`, `git status*`; `webfetch`, `websearch`, `external_directory`: deny; без `--auto` |
| Верифікатор | `ollama/qwen3-8b-16k` (інша родина, локально), 3 критерії — [`foreign-criteria.jsonl`](foreign-criteria.jsonl) |
| Команда | `npx tsx scripts/harness/run-queue.ts docs/lab4/foreign-tasks.jsonl --repo ../path-to-regexp --id f-01` · код: [`scripts/harness/foreign-queue.ts`](../../scripts/harness/foreign-queue.ts) |

## Прогони (2026-11-26)
| Прогін | Час | exit_status | Брами | Токени (вхід / вихід) | Журнал |
|---|---|---|---|---|---|
| 1 | 14:31, 39,4 с | `ok` | **fail** — 4/5: «змінено лише `src/index.ts`» ✗ | 28 085 / 952 | [`traces/foreign/f-01-1795696307314/run.json`](traces/foreign/f-01-1795696307314/run.json) · [вивід](traces/run-foreign.txt) |
| 2 | 14:36, 52,5 с | `ok` | **pass** — 5/5 | 30 294 / 956 (≈ $0,051 за `readMeta`) | [`traces/foreign/f-01-1795696588975/run.json`](traces/foreign/f-01-1795696588975/run.json) · [вивід](traces/run-foreign-2.txt) |

**Чому впав прогін 1 — баг харнеса, не агента.** Харнес кладе в дерево прогону символьне посилання `node_modules` на залежності основного checkout. У курсовому репозиторії його ловить рядок `node_modules` у `.gitignore` (доданий ще в Лаб. 3), а `.gitignore` форка має лише `node_modules/` — тека, не посилання. `git add -A` приніс посилання в `patch.diff`, і брама «лише `src/index.ts`» коректно впала. Сама зміна агента була бездоганна — один доданий рядок. Виправлено в харнесі (`run-task.ts`: `':(exclude)node_modules'`, коміт `28f0155`), а не в чужому `.gitignore`. Обидва журнали лишено.

**Вердикт верифікатора** (прогін 2, 58 с, [`traces/foreign/verdicts/f-01-1795696588975.json`](traces/foreign/verdicts/f-01-1795696588975.json), [вивід](traces/run-foreign-verify.txt)): `blocked: false` — C1 pass (JSDoc над `tokensToFunction` описує, що повертає функція), C2 pass (лише додано рядок коментаря, код не змінено), C3 pass (змінено лише `src/index.ts`).

**Що агент змінив** (прогін 2): рядок `/** Returns a function that executes token encoders and concatenates their results. */` над `function tokensToFunction(`. Зміна у форк **не комітилась** — дерево й гілку прибрано після прогону; повні артефакти (`output.txt`, `agent.log`, `patch.diff` — у них фрагменти чужого коду) — у форку: `reports/lab4/harness/f-01-*`. У курсовому репозиторії — лише журнали `run.json`, вердикт і виводи команд.
