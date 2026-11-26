# Обмежена зміна: `match()` на битому %-кодуванні називає параметр і сире значення

- Дата: 2026-11-24 · форк: https://github.com/lizka030330/path-to-regexp · нульова точка: `c439054f178ae93a09e30f902c3976ee5a2434a5` · база зміни: `ae3e0a0` (характеризаційні тести + Stryker)
- Коміт нового тесту (ПЕРЕД зміною): [26f6f61](https://github.com/lizka030330/path-to-regexp/commit/26f6f61) «test: new behaviour — decode error names the param and raw value (red before the change)»
- Коміт зміни: [291b8d3](https://github.com/lizka030330/path-to-regexp/commit/291b8d3b677d51fb157e209a3968f621e1f88597) · гілка: `lab4/change`
- План відкоту закомічено раніше за зміну: курсовий репозиторій `e2a773a` «docs(lab4): step 02 rollback plan (written before the change)» — до коміту `291b8d3` у форку.
- Чому проєктові це потрібно: баг, зафіксований тестами кроку 01 («бите %-кодування в параметрі / у wildcard» — `URI malformed` без жодного контексту, `characterization.md` §2, підписано «фіксую навмисне»); тип зміни за таблицею методички — «повідомлення про помилку, яке не каже, що саме не так».

## 1. Приймання (КОМАНДИ, не побажання)
| команда | очікуваний код виходу | фактичний |
|---|---|---|
| `npx vitest run src/characterization.spec.ts` | 0 | 0 (8 passed) |
| `npx vitest run src/decode-error.spec.ts` | 0 | 0 (3 passed) |
| `npm test` (усі тести + `size-limit` ≤ 2 kB) | 0 | 0 (558 passed у 5 файлах; 1.91 kB) |
| `git show --stat 291b8d3` — рівно 1 файл, `src/index.ts` | — | 1 файл, +14 / −2 |

## 2. Що змінено
| файл | рядків + / − | яке твердження цей файл підтверджує |
|---|---|---|
| `src/index.ts` (коміт `291b8d3`) | +14 / −2 | на битому %-кодуванні `match()` кидає `URIError` з повідомленням `Failed to decode param "<імʼя>" ("<сире значення>"): <оригінальне повідомлення>`; для wildcard — лише сегмент, що не декодувався; інші помилки `decode` прокидаються без змін |
| `src/decode-error.spec.ts` (коміт `26f6f61`, окремо й раніше) | +34 / −0 | новий тест на нову поведінку |

Рядок за рядком (`src/index.ts`, у функції `match`, після `if (decode === false) return NOOP_VALUE;`):
- `const decodeParam = (value: string) => {` — одна обгортка навколо `decode` для обох випадків (параметр і сегмент wildcard), щоб не дублювати `try/catch`.
- `try { return decode(value); }` — коректне декодування йде тим самим шляхом, що й раніше.
- `catch (err) { if (!(err instanceof URIError)) throw err;` — обгортаються **лише** помилки декодування URI; власні помилки користувацького `decode` лишаються свого типу (додано за зауваженням перегляду, див. §5).
- `throw new URIError(\`Failed to decode param "${key.name}" ("${value}"): ${(err as Error).message}\`)` — тип не змінюється (публічний API той самий), оригінальний текст `URI malformed` зберігається в кінці повідомлення.
- `if (key.type === "param") return decodeParam;` і `value.split(delimiter).map(decodeParam)` — замість `decode` підставлено обгортку; для wildcard `value` — окремий сегмент, тому в повідомленні саме він.
- Видалено 2 рядки: `return decode;` і `.map(decode)` — замінені тими самими викликами через обгортку.

Оновлене характеризаційне твердження: **немає**. Тести 7–8 кроку 01 перевіряють `toThrowError("URI malformed")` — це перевірка підрядка, а новий текст закінчується на `: URI malformed`, тому обидва лишились зеленими без правок. Тести кроку 01 у зміні не чіпались (`git diff 26f6f61 291b8d3 --stat` → лише `src/index.ts`).

## 3. Три докази
1. **Характеризація після зміни:** `npx vitest run src/characterization.spec.ts` → код виходу 0, `Tests 8 passed (8)`; повний набір `npm test` → код виходу 0, `Test Files 5 passed (5)`, `Tests 558 passed (558)`, `Size: 1.91 kB` при `Size limit: 2 kB` (було 1.84 kB). Логи у форку: `reports/lab4/char-after-change.txt`, `reports/lab4/npm-test-after-change.txt` (гілка `lab4/change`, коміт `75eff6e`).
2. **Новий тест:** на своєму коміті `26f6f61` (до зміни) — ЧЕРВОНИЙ: `Tests 2 failed | 1 passed (3)`, код виходу 1, `Expected: "Failed to decode param "test" ("caf%C3"): URI malformed"` · `Received: "URI malformed"` (`reports/lab4/decode-error-before.txt`); після зміни — ЗЕЛЕНИЙ: `Tests 3 passed (3)`, код виходу 0 (`reports/lab4/decode-error-after.txt`).
3. **До / після на тому самому вході** (входи — з `src/cases.spec.ts` L486 `/caf%C3%A9` з обрізаним байтом, як у тестах кроку 01; запуск обох версій `src/index.ts` через `node --experimental-transform-types`):

| вхід | до (`ae3e0a0`) | після (`291b8d3`) |
|---|---|---|
| `match("/:test")("/caf%C3")` | `URIError: URI malformed` | `URIError: Failed to decode param "test" ("caf%C3"): URI malformed` |
| `match("/*splat")("/bar/caf%C3")` | `URIError: URI malformed` | `URIError: Failed to decode param "splat" ("caf%C3"): URI malformed` |
| `match("/:test")("/caf%C3%A9")` | `{ path: "/caf%C3%A9", params: { test: "café" } }` | те саме |
| `match("/:test", { decode: false })("/caf%C3")` | `{ params: { test: "caf%C3" } }` | те саме |
| власний `decode`, що кидає `TypeError("my decoder: x")` | `TypeError: my decoder: x` | те саме |
| `match("/:test", { decode: 42 })("/x")` | `TypeError: decoder is not a function` | `TypeError: decode is not a function` — **тип той самий, змінилось імʼя змінної в тексті, який генерує рушій JS**; вхід суперечить типу `Decode`, прийнято свідомо |

Покриття `src/index.ts`: рядки 99.58 % → 99.59 %, гілки 97.5 % → 96.91 %. Нова гілка `if (!(err instanceof URIError)) throw err` (true) не покрита автотестом — її поведінку перевірено рядком «власний decode, що кидає TypeError» у таблиці вище.

## 4. Межі агента в цьому прогоні
- Інструмент і модель із версією: OpenCode 1.19.6, `opencode run` (неінтерактивно, **без `--auto`**), модель `google/gemini-3.6-flash`.
- Режим: власний агент `lab4-change` з deny-правилами — [`docs/lab4/opencode-change.json`](opencode-change.json); запуск: `OPENCODE_CONFIG=…/docs/lab4/opencode-change.json opencode run --agent lab4-change '<опис зміни>'`.
- Дозволені інструменти дослівно: `edit`: `"*": "deny"`, `"src/index.ts": "allow"`; `bash`: `"*": "deny"`, `"git diff*": "allow"`, `"git status*": "allow"`, `"*>*": "deny"`; `read`: усе, крім `*.env`, `*.env.*`; `webfetch`, `websearch`, `external_directory` — `deny`; `todowrite` вимкнено; `steps: 15`. Запуск тестів агентові **не дозволено** — тести запускала я після перегляду дифа. Окремо зафіксовано `agent.plan.permission`: `edit` і `bash` — `"*": "deny"`.
- Заборона на тестову теку дослівно: `"src/*.spec.ts": "deny"`, `"src/**/*.spec.ts": "deny"` (тести проєкту лежать у `src/` поруч із кодом), а також `package.json`, `package-lock.json`, `stryker.config.mjs` — `deny`.
- Взірець шляху: відносний `"src/index.ts": "allow"` **дав збіг** — агент змінив саме цей файл (обидва прогони), інших змін немає (`git status --short` після прогонів: лише ` M src/index.ts`).
- Ізоляція: `git worktree add -b lab4/change ../path-to-regexp-change ae3e0a0` · `git status` основного checkout після прогону: див. `rollback.md` §2 (чистий).
- Прогони: 19:48:52–19:49:40 (зміна) і 19:51:03–19:51:19 (виправлення за зауваженням перегляду). Логи (повні, у ФОРКУ — там фрагменти чужого коду; закомічено 2026-11-26 окремим `chore:`-комітом `903a4df`): [agent-change-run.txt](https://github.com/lizka030330/path-to-regexp/blob/903a4df/reports/lab4/agent-change-run.txt), [agent-change-run-2.txt](https://github.com/lizka030330/path-to-regexp/blob/903a4df/reports/lab4/agent-change-run-2.txt). До цього дня вони лежали лише на моєму ноутбуці — прогалину знайдено під час перевірки кроків 00–07.

## 5. Перегляд дифа
Хто і чим: я очима рядок за рядком **до першого запуску тестів** + Claude (Opus 5.5) як друга думка: запуск версій «до» і «після» `src/index.ts` на тих самих 6 входах (таблиця в §3). `claude ultrareview`/Codex `/review` не використовувались.
Що виправлено за зауваженнями: перша версія агента перехоплювала **будь-яку** помилку `decode` і перетворювала її на `URIError` (перевірено: власний `decode`, що кидає `TypeError`, давав `URIError: Failed to decode param…`). Це небажана зміна поведінки, яку тести не ловили (такого випадку в наборі немає; ризик названо заздалегідь у `characterization.md` §3). Тим самим агентом і тими самими межами додано `if (!(err instanceof URIError)) throw err;`.
Що відкинуто і чому:
- додати `{ cause: err }` до нового `URIError` — корисно для налагодження, але це ще одна зміна поведінки (нове поле), а запас `size-limit` малий (1.91 з 2 kB);
- прибрати зайве приведення `(err as Error)` (після перевірки `instanceof` воно не потрібне) — косметика, не змінює поведінку; диф лишаю мінімальним;
- відмінність тексту на `decode: 42` (`decoder` → `decode is not a function`) — тип помилки той самий, вхід суперечить TypeScript-типу; виправлення означало б зайву складність.

## 6. Кінцевий стан форка
Зміна лишається в гілці **`lab4/change`** (`291b8d3` + звіти `75eff6e`); відкот — доказом у гілці **`lab4/rollback-drill`** (`671ec0c` Revert + звіти), не зливається. `master` лишається на `ae3e0a0` (характеризаційні тести й Stryker) і зміни не містить.
