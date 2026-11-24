# q5: Які файли проєкту змінюються найчастіше, від чого src/index.ts залежить під час виконання і в якому коміті його перенесли в src/?

Найчастіше змінюваними файлами проєкту за кількістю комітів є package.json (117 комітів), src/index.ts (90), Readme.md (90), index.js (63), src/index.spec.ts (62) та package-lock.json (52). Під час виконання файл src/index.ts не має жодних зовнішніх сторонніх залежностей. У маніфесті package.json секція dependencies повністю відсутня, а визначено виключно devDependencies. Сам файл src/index.ts не містить жодної інструкції import. Для виконання своєї логіки код спирається виключно на глобальні вбудовані можливості JavaScript, зокрема encodeURIComponent, decodeURIComponent, RegExp та TypeError. В історії проєкту перейменування index.js в index.ts у корені спершу відбулося в коміті cc0df28. Остаточне перенесення index.ts до каталогу src/index.ts було здійснено в коміті 4f33bc4.

## Твердження (усі pass у верифікатора qwen3-8b-16k)
- c1: Перенесення index.ts до директорії src/index.ts було виконано в коміті 4f33bc4 під час стандартизації конфігурації TypeScript. — `commit:4f33bc4`
- c2: Перейменування index.js на index.ts у корені репозиторію відбулося в коміті cc0df28. — `commit:cc0df28`
- c3: У маніфесті package.json повністю відсутня секція dependencies, тобто runtime-залежності пакетів не оголошені. — `package.json#L1-L68`
- c4: Вихідний код src/index.ts не містить жодної інструкції import і не імпортує зовнішніх модулів. — `src/index.ts#L1-L697`
- c5: Під час виконання функція compile спирається на стандартну глобальну функцію encodeURIComponent. — `src/index.ts#L260`
- c6: Функція match під час виконання використовує стандартну вбудовану функцію decodeURIComponent. — `src/index.ts#L406`
