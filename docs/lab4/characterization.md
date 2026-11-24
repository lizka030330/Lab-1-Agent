# Характеризаційні тести: path-to-regexp

- Дата: 2026-11-24 · форк: https://github.com/lizka030330/path-to-regexp · нульова точка: `c439054f178ae93a09e30f902c3976ee5a2434a5`
- Область: функція `match()` у `src/index.ts` (L402–432) — на вході шаблон шляху й адреса (рядок), на виході `false` або `{ path, params }`, де параметри декодовані через `decode` (типово `decodeURIComponent`).
- Коміт із тестами: [16f2a46](https://github.com/lizka030330/path-to-regexp/commit/16f2a46738854a9508e03942b8d9c22c71dbcf80) «test: characterization tests for match() decoding (8 tests, values from blind run)» — у дифі лише `src/characterization.spec.ts` і `reports/lab4/characterization-blind-run.txt`; файл тестів: https://github.com/lizka030330/path-to-regexp/blob/16f2a46738854a9508e03942b8d9c22c71dbcf80/src/characterization.spec.ts

## 1. Що було з тестами до мене
- Запускач проєкту: vitest 5.0.5 (через `@borderless/ts-scripts` 0.15.0)
- Команда запуску дослівно: `npm test` (= `ts-scripts test && npm run size`); окремий файл — `npx vitest run src/characterization.spec.ts`
- Було тестів: 547 у 3 файлах (`src/index.spec.ts`, `src/cases.spec.ts` як дані, `src/redos.spec.ts`) · код виходу на нульовій точці: 0 (прогін 2026-11-24 18:54, `reports/lab4/protocol.txt` у форку)
- Тестову теку останнього разу чіпали: 2026-10-21 (`git log --oneline -- 'src/*.spec.ts'` → `af3b946` «Remove `TokenData` class and `Keys` type (#461)»)
- Що я приніс свого: запускач — нічого (працюю vitest проєкту); для мутаційного тестування — `@stryker-mutator/core` і `@stryker-mutator/vitest-runner` 10.1.1 окремим комітом `chore(test):`

## 2. Зафіксована поведінка
Файл: `src/characterization.spec.ts`. Значення в усіх `expect` отримано циклом «нехай падіння скаже правду»: спершу всі `expect` були `"?"`, прогін 2026-11-24 19:21 дав 8 падінь, фактичні значення взято з рядків `Received` (лог у форку: `reports/lab4/characterization-blind-run.txt`).

| тест | яка поведінка зафіксована | звідки значення | баг? |
|---|---|---|---|
| два параметри з README | кожен `:параметр` повертається рядком під своїм іменем: `{ path: "/test/route", params: { foo: "test", bar: "route" } }` | прогін 24.11 19:21; вхід — Readme.md L28–31 | ні |
| wildcard з README | `*splat` повертає **масив** сегментів: `{ splat: ["bar", "baz"] }` | прогін 24.11 19:21; вхід — Readme.md L39–42 | ні |
| необовʼязкова група без параметра | пропущена група дає `params: {}` — ключа `id` немає зовсім | прогін 24.11 19:21; вхід — Readme.md L50–53 | ні |
| адреса, що не підходить під шаблон | невідповідність — це `false`, а не помилка | прогін 24.11 19:21; вхід — шаблон з Readme.md L28 | ні |
| коректне %-кодування декодується один раз | `/param%2523` → `params.test = "param%23"` (`%25`→`%` один раз), `path` лишається сирим | прогін 24.11 19:21; вхід — src/cases.spec.ts L500–503 | ні |
| decode: false лишає параметр сирим | з `decode: false` → `params.test = "caf%C3%A9"` без декодування | прогін 24.11 19:21; вхід — src/cases.spec.ts L486 + Readme.md L65 | ні |
| бите %-кодування в параметрі | `match("/:test")("/caf%C3")` кидає неперехоплену помилку `URI malformed` | прогін 24.11 19:21 (`Received: "URI malformed"`) | **так, фіксую навмисне** — це змінює крок 02 |
| бите %-кодування у wildcard | `match("/*splat")("/bar/caf%C3")` кидає ту саму `URI malformed` | прогін 24.11 19:21 | **так, фіксую навмисне** — це змінює крок 02 |

Зелено на незміненому коді: `npx vitest run src/characterization.spec.ts` → код виходу 0, **8 passed** (2026-11-24 19:24); перед цим `git diff --stat c439054` — лише `reports/lab4/*`, `src/index.ts` не змінено. Повний набір: `npm test` → код виходу 0, **555 passed у 4 файлах** (`reports/lab4/npm-test-after-char.log`).

## 3. Що свідомо НЕ покрито
| що | чому не покрито | чим це загрожує на кроці 02 |
|---|---|---|
| `match()` з некоректним `path` (`null`, `{}`) — `TypeError` на L458–459 / L493 | поза областю зміни (це вхід `pathToRegexp`, а не декодування); поведінку перевірено вручну на кроці 00, `context.md` §5 п. 5 | якщо крок 02 додасть валідацію `path`, це вже інша зміна — свідомо не робимо |
| нерядковий `input` (`123`, `null`) → `false` | вхід не з проєкту (TypeScript-тип `string`), поведінку видно лише в обхід типів | зміна декодування його не торкається |
| `decode`, що не є функцією (`decode: 42`) → `TypeError: decoder is not a function` | вхід суперечить типу `Decode`; не стосується битого %-кодування | якщо крок 02 огорне виклик `decoder` у `try/catch`, ця помилка теж буде перехоплена — **це треба буде врахувати** |
| `delimiter`, відмінний від `/`, у wildcard (`value.split(delimiter)`) | покрито тестами проєкту (`cases.spec.ts`, `delimiter: '.'`), своїх не додавала | низька: зміна не чіпає `split` |
| межа 256 комбінацій (L460) | поза областю `match()`; мутант `>= 256` → `> 256` вижив (розділ 5) | не загрожує: крок 02 не змінює групи |

## 4. Покриття області
Інструмент: власний проєкту — `@vitest/coverage-v8` 5.0.5 (вмикається в `ts-scripts test`)
Команда дослівно: `npm test`
До моїх тестів: `src/index.ts` 99.58 % рядків · 97.5 % гілок · 100 % функцій · після: ті самі 99.58 % · 97.5 % · 100 % (рядок 599 непокритий в обох прогонах)
Непокриті гілки файлу (з `coverage/coverage-final.json`): L558, L615, L616, L681 — **жодна не в області `match()` (L402–432)**.
Непокриті гілки, які зачіпає крок 02: немає — уся область покрита ще до моїх тестів; мої тести додають не покриття, а **твердження** про поведінку на битому %-кодуванні, якої в наборі проєкту не було.

## 5. Мутаційний прогін
Інструмент: @stryker-mutator/core 10.1.1 (+ @stryker-mutator/vitest-runner 10.1.1; vitest 5.0.5). Методичка називає 10.0.0 — генератор `npm init stryker@latest` (create-stryker 10.1.1) поставив 10.1.1.
Конфігурація: `stryker.config.mjs` у форку — `mutate: ["src/index.ts"]` · `concurrency: 4` (8 логічних ядер) · `incremental: true` · `coverageAnalysis: "perTest"` · `tsconfigFile: "tsconfig.stryker-skip-rewrite.json"` (див. нижче)
Команда дослівно (надрукована генератором як `stryker run`): `npx stryker run`
Тривалість МОГО прогону: **1 хв 35 с** (2026-11-24 19:31:44–19:33:19 за логом; `time`: 1:35.45 total) · мутантів: **511** · убито: **466** · timeout: **17** · вижило: **24** · без покриття: **4** · помилок: 0 · mutation score 94.52 % (covered 95.27 %)
У середньому 59.83 тесту на мутанта.
Звіт (у ФОРКУ, коміт [ae3e0a0](https://github.com/lizka030330/path-to-regexp/commit/ae3e0a0dc982e5bf1f1f9d018b12516289c8f3f5) «chore(test): stryker 10.1.1…»): [mutation.html](https://github.com/lizka030330/path-to-regexp/blob/ae3e0a0dc982e5bf1f1f9d018b12516289c8f3f5/reports/mutation/mutation.html) · [mutation.json](https://github.com/lizka030330/path-to-regexp/blob/ae3e0a0dc982e5bf1f1f9d018b12516289c8f3f5/reports/mutation/mutation.json) · лог [stryker-run-2.txt](https://github.com/lizka030330/path-to-regexp/blob/ae3e0a0dc982e5bf1f1f9d018b12516289c8f3f5/reports/lab4/stryker-run-2.txt) · невдалий перший запуск [stryker-run-1.txt](https://github.com/lizka030330/path-to-regexp/blob/ae3e0a0dc982e5bf1f1f9d018b12516289c8f3f5/reports/lab4/stryker-run-1.txt) · конфігурація [stryker.config.mjs](https://github.com/lizka030330/path-to-regexp/blob/ae3e0a0dc982e5bf1f1f9d018b12516289c8f3f5/stryker.config.mjs)
Примітка: хук `lint-staged` проєкту при коміті переформатував `mutation.json` і `stryker-incremental.json` (лише відступи); статуси мутантів після коміту ті самі — 466 Killed, 24 Survived, 17 Timeout, 4 NoCoverage.

**Область `match()` (L402–432):** 27 мутантів — 25 убито, 1 timeout, **1 вижив**.

| вижилий мутант (файл#рядок, що змінено) | що зробив |
|---|---|
| `src/index.ts#L423` `i < m.length` → `i <= m.length` | лишив: **еквівалентний мутант**. На зайвій ітерації `i === m.length` значення `m[i]` — `undefined`, і L424 `if (m[i] === undefined) continue` її пропускає; результат `match()` не змінюється, тому жоден тест не може його вбити |
| `src/index.ts#L423` `i < m.length` → `i >= m.length` (Timeout) | нічого: timeout зараховується як виявлений (цикл стає нескінченним) |

**Поза областю — 23 вижилих**, свідомо не розбираю по одному, бо крок 02 їх не торкається: `parse` L190; `compile`/`tokenToFunction` L270, L333 (×2), L335, L338, L365, L368; `pathToRegexp` L460 (межа 256: `>=`→`>`); `toRegExpSource` L522, L525, L541, L558, L576, L578; `negate` L613, L615, L616 (×2), L617 (×2); `stringify` L666, L681. Без покриття — 4: L599 (×2, `Unknown token type`), L615, L616.

Перший запуск не відбувся: `TypeError: ts.parseConfigFileTextToJson is not a function` (`reports/lab4/stryker-run-1.txt`). Причина — TypeScript 7.0.2 у проєкті без компіляторного API, а `TSConfigPreprocessor` Stryker викликає його, щоб переписати відносні `extends`/`references` у `tsconfig.json`. У `tsconfig.json` проєкту `extends` — пакет із `node_modules`, переписувати нічого; тому в конфігурації вказано неіснуючий `tsconfigFile`, і препроцесор файл пропускає (`node_modules/@stryker-mutator/core/dist/src/sandbox/ts-config-preprocessor.js` L41–44). Тести мутантів від цього не змінились: 0 помилок, сухий прогін зелений.

Ще раніше генератор було запущено з помилковою відповіддю (preset `angular-cli` → `karma-runner`); зміни відкочено `git restore` до будь-якого прогону й коміту, генератор запущено вдруге (None/other → vitest).

## 6. Тести, згенеровані агентом
Інструмент і модель: Claude (Claude Opus 5.5) у чаті claude.ai, з доступом до теки форка через Claude desktop app; OpenCode для тестів не використовувався.
Режим дозволів: агент записував файли у форк лише через інструмент зі схваленим доступом до теки; `git commit` робила я. Заборона на правку тестів на рівні конфігурації для цього інструмента не налаштовувалась — контроль: `git diff --stat c439054` перед комітом (лише `reports/lab4/*`) і окремий коміт тестів, у якому немає `src/index.ts`.
Скільки тестів згенеровано: 8 (каркас із `"?"` і вхідними даними з Readme.md / cases.spec.ts) · скільки лишилося після перегляду: 8
Що виправив руками / як: значення `expect` агент підставив **з мого прогону наосліп** (рядки `Received`, лог у форку), а не з читання коду; коментарі «ЧОМУ» з номерами рядків звірено з `src/index.ts`; хук `lint-staged` при коміті нічого в тестах не змінив (`git diff 5d106d4 16f2a46 -- src/characterization.spec.ts` порожній). Чекліст «Перегляд згенерованого тесту»: усі `expect` — конкретні значення (жодного `toBeTruthy`/`expect.any`); входи — з проєкту, крім обрізаного байта в тестах 7–8 (битого %-кодування в проєкті немає — це записано в коментарі тесту); змін поза тестами — немає.
