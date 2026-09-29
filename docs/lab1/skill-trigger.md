# Тест спрацювання навички add-api-route

Навичка: `add-api-route`

Мета тесту — перевірити, що навичка автоматично підхоплюється для задач зі створення API-маршрутів і не підхоплюється для схожих, але нерелевантних задач.

## OpenCode

| # | Тип | Запит | Очікування | Результат | Доказ |
|---|---|---|---|---|---|
| 1 | Позитивний | Додай новий GET ендпоінт `/api/version` у цьому Next.js-проєкті. Він має повертати JSON із версією застосунку. | `add-api-route` має спрацювати | Спрацювала | [журнал, рядок 17](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/opencode.jsonl#L17) |
| 2 | Позитивний | Додай POST ендпоінт `/api/feedback`, який приймає JSON і повертає підтвердження у JSON. | `add-api-route` має спрацювати | Спрацювала | [журнал, рядок 33](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/opencode.jsonl#L33) |
| 3 | Позитивний | Створи GET API-маршрут `/api/status`, який повертає JSON зі статусом сервісу. | `add-api-route` має спрацювати | Спрацювала | [журнал, рядок 34](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/opencode.jsonl#L34) |
| 4 | Негативний | Зміни текст заголовка на головній сторінці на "Welcome to our app". | `add-api-route` не повинна спрацювати | Не спрацювала | [журнал, рядки 35–36](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/opencode.jsonl#L35-L36) — агент почав працювати без виклику `skill` |
| 5 | Негативний | Зміни колір кнопки на головній сторінці на синій. | `add-api-route` не повинна спрацювати | Не спрацювала | [журнал, рядок 37](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/opencode.jsonl#L37) — виклику `skill` немає |
| 6 | Негативний | Додай новий компонент Card для відображення інформації на головній сторінці. | `add-api-route` не повинна спрацювати | Не спрацювала | [журнал, рядки 38–39](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/opencode.jsonl#L38-L39) — виклику `skill` немає |

## Codex

| # | Тип | Запит | Очікування | Результат | Доказ |
|---|---|---|---|---|---|
| 1 | Позитивний | Додай новий GET ендпоінт `/api/version` у цьому Next.js-проєкті. Він має повертати JSON із версією застосунку. | `add-api-route` має спрацювати | Спрацювала | [журнал, рядок 13](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/codex.jsonl#L13) — Codex прочитав `add-api-route/SKILL.md` |
| 2 | Позитивний | Додай POST ендпоінт `/api/feedback`, який приймає JSON і повертає підтвердження у JSON. | `add-api-route` має спрацювати | Спрацювала | [журнал, рядок 16](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/codex.jsonl#L16) — Codex прочитав `add-api-route/SKILL.md` |
| 3 | Позитивний | Створи GET API-маршрут `/api/status`, який повертає JSON зі статусом сервісу. | `add-api-route` має спрацювати | Спрацювала | [журнал, рядок 18](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/codex.jsonl#L18) — Codex прочитав `add-api-route/SKILL.md` |
| 4 | Негативний | Зміни текст заголовка на головній сторінці на "Welcome to our app". | `add-api-route` не повинна спрацювати | Не спрацювала | Після запиту нових читань `SKILL.md` у журналі не з'явилось; останній виклик навички залишається на [рядку 18](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/codex.jsonl#L18) |
| 5 | Негативний | Зміни колір кнопки на головній сторінці на синій. | `add-api-route` не повинна спрацювати | Не спрацювала | Після запиту нових читань `SKILL.md` у журналі не з'явилось; останній виклик навички залишається на [рядку 18](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/codex.jsonl#L18) |
| 6 | Негативний | Додай новий компонент Card для відображення інформації на головній сторінці. | `add-api-route` не повинна спрацювати | Не спрацювала | Після запиту нових читань `SKILL.md` у журналі не з'явилось; останній виклик навички залишається на [рядку 18](https://github.com/lizka030330/Lab-1-Agent/blob/a4b26fb/.agent-log/codex.jsonl#L18) |

## Підсумок

- OpenCode: 3/3 позитивних запитів викликали `add-api-route`; 3/3 негативних — не викликали.
- Codex: 3/3 позитивних запитів призвели до читання `add-api-route/SKILL.md`; 3/3 негативних — не призвели до читання навички.
- Навичка коректно спрацьовує в обох інструментах і не спрацьовує для змін сторінок, компонентів та стилів.