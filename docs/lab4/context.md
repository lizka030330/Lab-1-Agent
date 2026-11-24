# Відновлений контекст: path-to-regexp

- Дата: 2026-11-24
- Оригінал: https://github.com/pillarjs/path-to-regexp · мій форк: https://github.com/lizka030330/path-to-regexp
- Ліцензія: MIT (The MIT License, © 2014 Blake Embrey), файл: https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/LICENSE
- Нульова точка (SHA базового коміту форка): `c439054f178ae93a09e30f902c3976ee5a2434a5` («Escape with a lookahead insert (#465)», 2026-11-21)
- Node у мене: v24.21.0 (npm 11.19.0, macOS arm64) · Node, якого просить проєкт (engines): **не оголошено**; CI проєкту гоняє Node 22 і latest
- Режим читання агента: OpenCode, власний primary-агент `lab4-readonly` (аналог субагента explore + явні правила),
  конфігурація: [`docs/lab4/opencode-readonly.json`](opencode-readonly.json) — `edit: deny`, інструменти write/edit/patch вимкнено,
  `webfetch: deny`, `external_directory: deny`, `.env` не читається, bash: `"*": deny` першим, далі лише `git log/show/blame/rev-parse/status`, `ls`, `grep`, `wc`.
  Запуск: `OPENCODE_CONFIG=<шлях>/docs/lab4/opencode-readonly.json opencode --agent lab4-readonly` у теці форка.

## 1. Що проєкт робить
Ця бібліотека допомагає сайту розпізнавати адреси сторінок, діставати з них потрібні значення та збирати адреси назад із готових даних. Вона маленька, незалежна від інших бібліотек і міститься в одному файлі. Вона призначена для розробників і маршрутизаторів (наприклад, у вебфреймворках), яким потрібно керувати маршрутами. Результат віддається у вигляді готових об'єктів зі знайденими параметрами, сформованих адрес або правил перевірки для подальшої роботи програми.

## 2. Як його запустити й протестувати
| крок | команда дослівно | код виходу | що побачив |
|---|---|---|---|
| встановлення | `npm ci` | 0 | 3 с; попереджень WARN — 0, про peer-залежності — 0 (npm 11.19.0) |
| збірка | `npm run build` | 0 | `ts-scripts build` → `rimraf` + `tsc --build`, результат у `dist/` (у `.gitignore`) |
| тести | `npm test` | 0 | **547 тестів, 3 файли** (`Test Files 3 passed`, `Tests 547 passed`), покриття `src/index.ts` 99.58 % рядків, непокритий рядок 599; далі `size-limit`: 1.84 kB із лімітом 2 kB |
| лінт | `npm run lint` | **1** | `❌ Script does not exist: lint` — у `@borderless/ts-scripts` 0.15.0 немає команди `lint` (є build/check/format/install/specs/test) |
| що перевіряє CI | `.github/workflows/ci.yml`: `npm install`, `npm test` (матриця Node 22 і latest) | — | лінт і збірку CI окремо не запускає; `release.yml`: `npm ci --ignore-scripts`, `npm test`, `npm stage publish` |

Точки входу (`package.json`): `"main": "dist/index.js"`, `"exports": "./dist/index.js"`, `"typings": "dist/index.d.ts"`, `"type": "module"`; `bin` немає.
Тобто пакет споживають лише через зібраний `dist/`, а джерело — `src/index.ts`.

## 3. Пʼять файлів, що мають значення
| файл (permalink) | чому саме він | звідки знаю |
|---|---|---|
| [src/index.ts](https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts) | уся логіка й усі експорти (`parse`, `compile`, `match`, `pathToRegexp`, `stringify`) | ранжування: 90 комітів (2-ге місце серед коду); `git log --follow -M30%` — 154 коміти з 2012; граф: єдиний модуль, який імпортують інші |
| [src/cases.spec.ts](https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/cases.spec.ts) | таблиці тестових випадків (`PARSER_/STRINGIFY_/COMPILE_/MATCH_TESTS`), 2865 рядків — фактично специфікація поведінки | прочитав; jscpd: усі 9 клонів — тут |
| [src/index.spec.ts](https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.spec.ts) | проганяє таблиці з cases.spec.ts + окремі тести помилок | ранжування: 62 коміти; граф: імпортує `index.ts` і `cases.spec.ts` |
| [package.json](https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/package.json) | точки входу, скрипти, TypeScript ^7.0.2, немає `engines`, зламаний `lint` | ранжування: 116 комітів (1-ше місце) |
| [.github/workflows/ci.yml](https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/.github/workflows/ci.yml) | єдина брама проєкту: `npm install` + `npm test` на Node 22 і latest | прочитав |

Історія: ранжування — `git log --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -10`
(116 package.json, 90 src/index.ts, 90 Readme.md, 63 index.js, 62 src/index.spec.ts, …; `index.js` і `test.ts` — старі імена до перейменувань).
`git log --follow -- src/index.ts` з типовим порогом схожості дає 90 комітів і **обривається 2019-11-12** на коміті `4f33bc4`
(«Standardize TypeScript package configuration»: `index.ts` → `src/index.ts`, схожість 33 %). З `-M30%` історія йде далі:
`index.js` → `index.ts` (69 %) → перший коміт `b1ec0d0` 2012-08-01, разом 154 коміти.
Blame: `git blame -w -C --ignore-rev 1c265a1 --ignore-rev b45871b -- src/index.ts` — ігнорую два масові коміти форматування
(`1c265a1` 2024-04-06 «Upgrade dev deps, prettier format», `b45871b` 2022-02-10 «Reformat repo…»). Після цього 653 з 696 рядків — Blake Embrey, решта — 5 інших авторів.

## 4. Карта залежностей модуля зміни
Модуль: `src/index.ts` (функція `match`)
Команда дослівно (з теки форка): `~/lab4-tools/node_modules/.bin/depcruise --no-config -T text src` (dependency-cruiser 18.7.0, встановлений в окрему теку `~/lab4-tools` разом із typescript 5.9.3)
Звіт (у ФОРКУ, не тут; коміт `42a0bf6` «chore: lab4 step 00 analysis reports»): [depcruise-src.txt](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/depcruise-src.txt) · [depcruise-graph.mmd](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/depcruise-graph.mmd) · [depcruise-cycles.txt](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/depcruise-cycles.txt) · [depcruise-info.txt](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/depcruise-info.txt) · [madge-circular.txt](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/madge-circular.txt)
- імпортує: нічого (жодного `import` у файлі; runtime-залежностей у пакета немає)
- імпортується з: `src/index.spec.ts`, `src/redos.spec.ts`, `src/index.bench.ts`; `src/cases.spec.ts` імпортує з нього **лише типи** (`type MatchOptions`, …) — dependency-cruiser без `tsPreCompilationDeps` їх не показує
- цикли: немає (`-T err`: «no dependency violations found (40 modules, 78 dependencies cruised)»; madge 8.0.0 `--circular`: «No circular dependency found»)

Чому не `npx dependency-cruiser@18.7.0` напряму: перший запуск дав «0 modules, 0 dependencies cruised». Причина — TypeScript 7.0.2 у проєкті
є нативною збіркою без компіляторного API (`node_modules/typescript/lib` містить лише `tsc.js`, `getExePath.js`), а `depcruise --info` показує підтримку `typescript >=2.0.0 <7.0.0`.

## 5. Як воно працює — три перевірені твердження
1. `parse()` не дозволяє неекранованих спецсимволів `}()[]+?!` у шаблоні й кидає `PathError` з індексом символу — https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L229-L231 — перевірив: прочитав цикл `consumeUntil` (L149–247).
2. `compile()` збирає відсутні параметри в масив і кидає `TypeError("Missing parameters: …")`, але для необовʼязкової групи `{…}` відкочує цей масив до попередньої довжини, тобто група просто пропускається — https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L270 і https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L315-L324 — перевірив: прочитав `compile` і `tokenToFunction`.
3. `match()` за замовчуванням декодує кожен параметр через `decodeURIComponent` (L406) і викликає декодер без перехоплення помилок (L428); у файлі немає жодного `try/catch` — https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L406 і https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L428 — перевірив: прочитав `match` (L402–432) і `grep -n 'try\|catch' src/index.ts` (порожньо).
4. `pathToRegexp()` обмежує кількість варіантів шляху (через необовʼязкові групи) до 256 і далі кидає `PathError("Too many path combinations")`; регулярний вираз типово нечутливий до регістру (`sensitive ? "" : "i"`) — https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L460-L462 і https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L481 — перевірив: прочитав `pathToRegexp` (L438–482).

Відповідь агента на питання 1 (шлях до `match`) звірено: `match` L402, виклик `pathToRegexp` L408, декодери L410–414, повернення замикання L416 — усі рядки збіглися.
5. Некоректний вхід у публічні функції не валідується: `match(null)` падає з `TypeError: Cannot read properties of null (reading 'tokens')`, бо `typeof null === "object"` пропускає `parse` (https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L458-L459); `pathToRegexp({})` падає на `tokens.length` (https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L493); `decode: 42` дає `TypeError: decoder is not a function` на https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L428; нерядковий `input` мовчки приводиться до рядка в `regexp.exec` (https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L417) — `match("/:id")(123)` і `(null)` повертають `false`. — перевірив: прочитав рядки й запустив на зібраному `dist/index.js` (`node --input-type=module -e …`, у форку нічого не змінено).

Звірка відповідей агента на питання 2 і 3 (сесія 2026-11-24 19:04): підтверджено — `URIError` на битому `%` для `:param` і `*wildcard` (з `decode:false` помилки немає), `null`/`{}` як `path`, нефункціональний `decode`, приведення `input`, `MATCH_TESTS` у `src/index.spec.ts` L294 і `src/cases.spec.ts` L411, «Missing text before» L560. Неточно — межу 256 агент назвав на L461, перевірка стоїть на L460 (L461 — `throw`). Відкинуто — «тестуються лише успішні збіги»: в `src/index.spec.ts` є окремі тести помилок `parse`. Не перевірено — інваріант синхронності груп regexp і `keys` (агент не дав рядка) → питання 3 у розділі 7.

## 6. Зони ризику
| зона | чим підтверджено | чому це ризик для зміни кроку 02 |
|---|---|---|
| `match()` → декодер параметрів, L406–L428 | складність 4 (ESLint `complexity`); немає `try/catch`; у 547 тестах немає жодного випадку з битим `%`-кодуванням (`grep URIError\|%E0\|malformed` у `*.spec.ts` — порожньо) | поведінка на некоректному вході не зафіксована тестами — її спершу треба зафіксувати характеризаційним тестом (крок 01), інакше зміну нічим перевірити |
| `consumeUntil` у `parse()`, L149 | складність **19** (поріг ядра ESLint — 20), 97 рядків (поріг 50) | найскладніша функція; будь-яка зміна синтаксису шаблону йде сюди — свідомо не чіпаю |
| `toRegExpSource`, L514 | складність **15**, 94 рядки | генерація regexp і захист від ReDoS (`redos.spec.ts` через `recheck`); зміна тут може відкрити ReDoS |
| `package.json` / тулінг | 116 комітів; TypeScript ^7.0.2 (typescript-eslint не підходить: peer `<6.1.0`; dependency-cruiser — `<7.0.0`); `npm run lint` → exit 1; `engines` не оголошено | інструменти аналізу треба тримати поза форком; власний лінт проєкту не працює, тож брама — лише `npm test` |
| дублювання | jscpd 5.4.2: 9 клонів, 133 рядки (3.35 %) — **усі в `src/cases.spec.ts`**, у `src/index.ts` клонів немає | низький ризик для коду; нові тестові випадки легко зробити копією існуючих |

Складність: `eslint` 10.13.0 з власною конфігурацією в `~/lab4-tools/eslint.config.mjs` (парсер `@typescript-eslint/parser` 8.72.0 на typescript ^5.4.4, правила ядра `complexity` з `max: 1`, щоб побачити число для кожної функції, і `max-lines-per-function` 50). Звіти: [eslint-complexity.txt](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/eslint-complexity.txt), [jscpd-report.md](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/jscpd/jscpd-report.md), протокол [protocol.txt](https://github.com/lizka030330/path-to-regexp/blob/42a0bf68dce417ebb9c9d0da4d59e70bcfef4067/reports/lab4/protocol.txt) — у форку.

Примітка про коміт звітів: `npm ci` виконав `prepare` проєкту, і під час `git commit` спрацював git-хук проєкту `lint-staged`, який переформатував три файли звітів (`eslint.config.mjs`, `jscpd-report.md`, `jscpd-report.json`). Порівняння з резервною копією, яку зробив сам lint-staged (`git diff bc99660 42a0bf6 -- reports`), показує лише вирівнювання пробілів і переноси рядків — жодне число не змінилося.

## 7. Три питання, на які я відповіді не знайшов
1. Чому межа комбінацій саме 256 (L460)? — де шукав: коміт `22a9679` «Reject large optional route combinations (#424)» (тіло коміту порожнє), Readme.md (про 256 нічого), `git log -S'256'` — що блокує: не знаю, чи це запас від ReDoS, чи довільне число; якщо зміна вплине на групи, не знатиму, чи можна наближатися до межі.
2. Чи `URIError` з `match()` на битому `%`-кодуванні — це задумана частина контракту, чи прогалина? — де шукав: Readme.md L65 (лише «default: `decodeURIComponent`»), L135, `*.spec.ts` (немає тестів), `src/index.ts` (немає `try/catch`) — що блокує: від відповіді залежить, чи можна змінювати цю поведінку в кроці 02, не ламаючи користувачів (Express).
3. Чи гарантує `toRegExpSource` (https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L514), що кожному ключу в `keys` відповідає рівно одна група захоплення в regexp, на яку спирається `match` (`keys[i - 1]`, `decoders[i - 1]`, https://github.com/lizka030330/path-to-regexp/blob/c439054f178ae93a09e30f902c3976ee5a2434a5/src/index.ts#L421-L429)? — де шукав: відповідь агента (твердить «гарантується побудовою», рядка не дав), `toRegExpSource` L514–607 (не дочитав, складність 15), Readme.md — що блокує: якщо зміна кроку 02 торкнеться побудови regexp, розсинхронізація дасть неправильні `params` без жодної помилки.

## 8. Перевірка одногрупником
Хто: <!-- TODO --> · дата: <!-- TODO -->
На чому спіткнувся: <!-- TODO -->
Що я після цього дописав: <!-- TODO: коміт у курсовому репозиторії -->
