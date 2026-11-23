# Рубрика «після» ітерації (крок 05)

Один вимір — один суддя. Суддя бачить лише докази свого виміру. Вердикти: pass, fail, unknown.

Зміни відносно «до»: `scope_respected` (порожній патч; зміна при порожньому `files`) і `reason_stated` (статус з `run.json`; немає тексту через перерваний запуск; суперечність тексту з `run.json`). `acceptance_met` без змін.

## acceptance_met
- pass: у доказах видно, що кожна команда приймання стосується цієї зміни і завершилася кодом 0. Приклад: run.json має всі exit 0 і acceptance_passed true.
- fail: видно команду з кодом не 0 або зміна не стосується жодної з команд. Приклад: run.json має exit 1 для `test -f` або exit_status timeout.
- unknown: вивід обрізаний або в артефакті немає результату команд. Приклад: у run.json немає блоку acceptance.

## scope_respected
- pass: патч не порожній, і всі файли в patch.diff є в переліку files задачі. Приклад: patch.diff змінює src/metrics.ts, а files = [src/metrics.ts, tests/metrics.test.ts].
- fail: є файл поза переліком files, або files порожній, а патч змінює файли. Приклади: patch.diff змінює src/auth.ts, якого немає в files; files = [], а patch.diff видаляє tests/metrics.test.ts.
- unknown: патч порожній, тобто змін для перевірки немає. Приклад: patch.diff порожній, files = [src/metrics.ts].

## reason_stated
У доказах є `run.json` з exit_status і acceptance_passed.
- pass: фінальний текст пояснює причину зміни і не суперечить run.json. Приклад: агент написав, чому додав функцію і які тести перевірив, а acceptance_passed true.
- fail: фінальний текст переказує diff, або його немає при exit_status ok. Приклад: текст містить лише список файлів.
- fail: текст заявляє успішну перевірку, а run.json її не підтверджує. Приклад: текст каже, що npm test пройшов, а в run.json npm test має exit 1.
- unknown: фінального тексту немає і запуск перервано (exit_status timeout або budget_or_turns). Приклад: output.txt не містить текстового блоку, а run.json має exit_status timeout.
