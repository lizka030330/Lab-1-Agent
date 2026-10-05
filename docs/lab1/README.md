# Пакет доказів — Лабораторна 1

Репозиторій: https://github.com/lizka030330/Lab-1-Agent · автор: lizka030330

## Інструменти

| Інструмент | Версія (`<інструмент> --version`) | Моделі в сесіях |
|---|---|---|
| OpenCode | `1.18.34` (на кроках 00–05 — 1.18.32–1.18.33, див. журнал автономності) | OpenCode Zen Big Pickle |
| Codex CLI | `codex-cli 0.157.1` | GPT-6-Astra, GPT-6.1-Sol (за замовчуванням) |
| Власний агентний цикл (`src/agent/`) | — | qwen3:4b-instruct (Ollama), gemini-3.8-flash, nvidia/nemotron-3.5-lightning:free (OpenRouter) |

## Як запустити у двох інструментах

Спільне для обох:

    git clone https://github.com/lizka030330/Lab-1-Agent.git
    cd Lab-1-Agent
    npm install
    cp .env.example .env.local    # заповнити ключі; файл у .gitignore
    npm run typecheck && npm run lint && npm test && npm run build

**OpenCode** — запуск `opencode` у корені репозиторію.
- Читає `AGENTS.md` і навички з `.claude/skills/`.
- Журнал: плагін `.opencode/plugins/agent-log.js` → `.agent-log/opencode.jsonl`.
- Заборона `.env`: маски в `opencode.json` + плагін `.opencode/plugins/guard-env.js` (пише `result: "denied"`).
- MCP Context7 — у `opencode.json`. Режим плану — клавіша `Tab` (Plan ↔ Build).

**Codex CLI** — запуск `codex` у корені репозиторію.
- Читає `AGENTS.md`; навички — лише з `.agents/skills/` (синхронізація: `npm run sync-skills`).
- Журнал: `.codex/hooks.json` (`PostToolUse`) + `scripts/agent-log-hook.mjs` → `.agent-log/codex.jsonl`; hook треба довірити в `/hooks`.
- MCP Context7 — глобально в `~/.codex/config.toml` (OAuth). Режим плану — `/plan`.

Відмінності між інструментами — `docs/lab1/portability.md`.

## Документи пакета

| Файл | Що доводить |
|---|---|
| [autonomy-log.md](autonomy-log.md) | журнал автономності: сесії 27.09–04.10, рівні довіри, втручання, обґрунтування мови (множник ua/en) |
| [agents-md-40.md](agents-md-40.md) | тест «видали 40%» для `AGENTS.md` (гілки `lab1/agents-md-40-full`, `lab1/agents-md-40-cut`) |
| [confident-errors.md](confident-errors.md) | плани двох агентів і впевнені помилки з посиланнями на рядки журналу (крок 03) |
| [portability.md](portability.md) | таблиця переносності OpenCode ↔ Codex, доказ скріншот-тесту |
| [skill-trigger.md](skill-trigger.md) | тест на спрацювання навички `add-api-route`: 3+3 запити в кожному інструменті |
| [context-cost.md](context-cost.md) | ціна MCP-сервера Context7 |
| [e2e-home.png](e2e-home.png) | скріншот браузерного тесту з артефакту CI (крок 06) |
| [cost.md](cost.md) | оцінка vs факт (0.0%), кеш, множник ua/en, три прогони хмара · шлюз · локально |
| [comparison.md](comparison.md) | агент кодування vs власний цикл (хмара/локально), 10 прогонів валідації, власний цикл vs AI SDK |
| [model-decision.md](model-decision.md) | заміна моделі ролі `local`: qwen3:4b → qwen3:4b-instruct з числами «до/після» |
| [intro-draft.md](intro-draft.md) | чернетка «Вступу» курсової — ЗАПОВНИТИ |
| [traces/](traces/) | скріншоти трас Langfuse: список трас (`trace-0.png`) і три траси з токенами, вартістю та викликом `getTime` (`trace-1.png`…`trace-3.png`) |

## Журнали дій агентів

- `.agent-log/opencode.jsonl`, `.agent-log/codex.jsonl` — сесії агентів кодування (формат: `ts`, `tool`, `input`, `result`, `session`, `source`).
- `.agent-log/agent-loop.jsonl` — власний цикл. Прогін «до» заміни моделі (qwen3:4b, `max-steps`): [#L4](https://github.com/lizka030330/Lab-1-Agent/blob/1bd6cdf/.agent-log/agent-loop.jsonl#L4); 10 прогонів «після» (10 з 10 валідних): [#L8–L37](https://github.com/lizka030330/Lab-1-Agent/blob/1bd6cdf/.agent-log/agent-loop.jsonl#L8-L37).
- Рядки `result: "denied"` (заборона `.env`, крок 05, записані плагіном `guard-env.js`): переадресація в оболонці [#L41](https://github.com/lizka030330/Lab-1-Agent/blob/ad060d2/.agent-log/opencode.jsonl#L41), підпроцес `node -e` [#L43](https://github.com/lizka030330/Lab-1-Agent/blob/ad060d2/.agent-log/opencode.jsonl#L43), читання `.env` [#L44](https://github.com/lizka030330/Lab-1-Agent/blob/ad060d2/.agent-log/opencode.jsonl#L44), обхідний шлях `./.env` [#L51](https://github.com/lizka030330/Lab-1-Agent/blob/ad060d2/.agent-log/opencode.jsonl#L51), інструмент `edit` [#L52](https://github.com/lizka030330/Lab-1-Agent/blob/ad060d2/.agent-log/opencode.jsonl#L52).

## Гілки

| Гілка | Що в ній |
|---|---|
| `lab1/agents-md-40-full`, `lab1/agents-md-40-cut` | тест «видали 40%» |
| `lab1/health-opencode` | `/api/health` від OpenCode (злито в `main`) |
| `lab1/health-codex` | `/api/health` від Codex (доказ, не злито) |
| `lab1/health-loop` | `/api/health` за пропозицією власного циклу, від базового коміту `daeae8e`; коміт `649d53a` |

## CI

- Зелений прогін `main` (коміт `3046318`: «Типи, лінт, тести, збірка» і Playwright зелені): https://github.com/lizka030330/Lab-1-Agent/actions/runs/37299008777
- Самоперевірка брам: навмисна помилка типу в тимчасовій гілці `tmp/gate-check` → job «Типи, лінт, тести, збірка» червоний, Playwright пропущено: https://github.com/lizka030330/Lab-1-Agent/actions/runs/37229384110 (гілку після перевірки видалено). Preview-деплой цієї гілки у Vercel теж завершився статусом Error — зламаний код не зібрався й там.
- «Поганий патч» від викладача (червоний прогін на пул-реквесті): ЗАПОВНИТИ.

## Деплой і траси

- Ендпоінт: https://lab-1-agent.vercel.app/api/agent (Vercel, план Hobby); перевірка без моделі: https://lab-1-agent.vercel.app/api/health
- Команда виклику:

      URL='https://lab-1-agent.vercel.app/api/agent'
      for p in 'Котра зараз година?' 'Скільки хвилин лишилось до півночі?' 'Привітайся одним реченням'; do
        printf '{"prompt":"%s"}' "$p" | curl -s -X POST "$URL" -H 'Content-Type: application/json; charset=utf-8' --data-binary @-; echo
      done

- Траси: Langfuse Cloud (EU), функція `lab01-agent`; скріншоти — `docs/lab1/traces/` (список і три траси 05.10 о 03:43–03:45: дерево `invoke_agent` → `step` → `chat` / `getTime`, токени й вартість за прайсом $0.00).
- Модель деплою: перемикач `LLM_PROVIDER` у `app/api/agent/route.ts`. Через вичерпану денну квоту Gemini (HTTP 429) траси знято з `nvidia/nemotron-3.5-lightning:free` через OpenRouter (запасний варіант із методички); для неї й для `gemini-3.8-flash` у Langfuse додано визначення моделей із цінами (0 і $0.75/$3.75 за 1M), бо без них вартість у трасах була порожньою.
- Знайдена помилка: з кодом методички траси не з'являлися — `registerTelemetry()` в `instrumentation.node.ts` не діяв у маршруті (окремий бандл), тож інтеграцію Langfuse передано в `telemetry.integrations` агента (коміт `8006fcd`).