# Лист калібрування верифікатора харнеса (крок 02)

Розмічаю я, ДО запуску судді. По кожному випадку — `pass`, `fail` або `unknown` за правилом:
- **pass** — у patch.diff видно, що критерій виконано повністю;
- **fail** — критерій порушено або виконано частково (коду/тесту немає, тест очікує не те, що робить код, змінено зайве);
- **unknown** — з patch.diff принципово неможливо судити.

Артефакти — справжні прогони фабрики 13.11.2026 (`docs/lab3/runs/`). Які моделі їх зробили, тут свідомо не вказано, щоб не впливати на розмітку.

## Артефакт `t-01-1794565498582` — задача t-01

Задача: У файлі src/metrics.ts додай експортовану функцію median(values: readonly number[]): number — медіана переліку чисел; для порожнього переліку кидай RangeError, як це робить mean у тому самому файлі. У tests/metrics.test.ts додай тести: непарна кількість, парна кількість (середнє двох середніх), порожній перелік кидає RangeError. Інших файлів не змінюй.

Коди виходу команд приймання: `grep -q 'export function median' src/metrics.ts` → 0, `grep -q 'median' tests/metrics.test.ts` → 0, `npm run typecheck` → 2, `npm test -- tests/metrics.test.ts` → 1

```diff
diff --git a/src/metrics.ts b/src/metrics.ts
index 746dcdf..294918b 100644
--- a/src/metrics.ts
+++ b/src/metrics.ts
@@ -41,6 +41,24 @@ export function reciprocalRank(hits: readonly Hit[], mustCite: readonly string[]
 }
 
 export function mean(values: readonly number[]): number {
+  if (values.length === 0) {
+    throw new RangeError('Mean of empty list');
+  }
+  const sum = values.reduce((acc, val) => acc + val, 0);
+  return sum / values.length;
+}
+
+export function median(values: readonly number[]): number {
+  if (values.length === 0) {
+    throw new RangeError('Median of empty list');
+  }
+  const sorted = [...values].sort((a, b) => a - b);
+  const mid = values.length / 2;
+  if (values.length % 2 === 1) {
+    return sorted[Math.floor(mid)];
+  }
+  return (sorted[mid - 1] + sorted[mid]) / 2;
+}
   if (values.length === 0) {
     throw new RangeError('середнє порожнього переліку не визначено — скільки запитів ви взяли?');
   }
diff --git a/tests/metrics.test.ts b/tests/metrics.test.ts
index 95383c5..a7f6cd0 100644
--- a/tests/metrics.test.ts
+++ b/tests/metrics.test.ts
@@ -1,5 +1,19 @@
 import { describe, expect, it } from 'vitest';
 
+describe('metrics', () => {
+  it('should calculate median for odd count', () => {
+    expect(median([1, 3, 5])).toBe(3);
+  });
+
+  it('should calculate median for even count', () => {
+    expect(median([1, 2, 3, 4])).toBe(2.5);
+  });
+
+  it('should throw RangeError for empty list', () => {
+    expect(() => median([])).toThrow(RangeError);
+  });
+});
+
 import {
   docsAtK,
   mean,
```

| № | Критерій | Мій вердикт |
|---|---|---|
| 1 | **C1**: У src/metrics.ts є експортована функція median(values), що повертає медіану: для непарної кількості — середній елемент після сортування, для парної — середнє двох середніх. | |
| 2 | **C2**: Для порожнього переліку median кидає RangeError (як mean у тому самому файлі). | |
| 3 | **C3**: У tests/metrics.test.ts є тести median на непарну кількість, на парну кількість і на те, що порожній перелік кидає RangeError; тести імпортують median. | |
| 4 | **C4**: Наявні функції в src/metrics.ts (зокрема mean) не змінено, а інших файлів, крім src/metrics.ts і tests/metrics.test.ts, зміна не торкається. | |

## Артефакт `t-01-1794571697367` — задача t-01

Задача: У файлі src/metrics.ts додай експортовану функцію median(values: readonly number[]): number — медіана переліку чисел; для порожнього переліку кидай RangeError, як це робить mean у тому самому файлі. У tests/metrics.test.ts додай тести: непарна кількість, парна кількість (середнє двох середніх), порожній перелік кидає RangeError. Інших файлів не змінюй.

Коди виходу команд приймання: `grep -q 'export function median' src/metrics.ts` → 0, `grep -q 'median' tests/metrics.test.ts` → 0, `npm run typecheck` → 0, `npm test -- tests/metrics.test.ts` → 0

```diff
diff --git a/src/metrics.ts b/src/metrics.ts
index 746dcdf..48cd3ca 100644
--- a/src/metrics.ts
+++ b/src/metrics.ts
@@ -47,6 +47,18 @@ export function mean(values: readonly number[]): number {
   return values.reduce((sum, v) => sum + v, 0) / values.length;
 }
 
+export function median(values: readonly number[]): number {
+  if (values.length === 0) {
+    throw new RangeError('медіана порожнього переліку не визначена');
+  }
+  const sorted = [...values].sort((a, b) => a - b);
+  const mid = Math.floor(sorted.length / 2);
+  if (sorted.length % 2 === 1) {
+    return sorted[mid]!;
+  }
+  return (sorted[mid - 1]! + sorted[mid]!) / 2;
+}
+
 /**
  * nDCG@k для НЕбінарної релевантності: `gains` — оцінка кожного документа (0, 1, 2…).
  * Беріть лише тоді, коли ці оцінки у вас справді розставлені рукою.
diff --git a/tests/metrics.test.ts b/tests/metrics.test.ts
index 95383c5..c792334 100644
--- a/tests/metrics.test.ts
+++ b/tests/metrics.test.ts
@@ -3,6 +3,7 @@ import { describe, expect, it } from 'vitest';
 import {
   docsAtK,
   mean,
+  median,
   ndcgAtK,
   proportionCI95,
   recallAtK,
@@ -96,3 +97,17 @@ describe('переходи вердиктів', () => {
     expect(rows).toContainEqual({ from: 'correct', to: 'wrong', ids: ['q-03'] });
   });
 });
+
+describe('median', () => {
+  it('непарна кількість елементів', () => {
+    expect(median([3, 1, 2])).toBe(2);
+  });
+
+  it('парна кількість елементів (середнє двох середніх)', () => {
+    expect(median([4, 1, 3, 2])).toBe(2.5);
+  });
+
+  it('порожній перелік кидає RangeError', () => {
+    expect(() => median([])).toThrow(RangeError);
+  });
+});
```

| № | Критерій | Мій вердикт |
|---|---|---|
| 5 | **C1**: У src/metrics.ts є експортована функція median(values), що повертає медіану: для непарної кількості — середній елемент після сортування, для парної — середнє двох середніх. | |
| 6 | **C2**: Для порожнього переліку median кидає RangeError (як mean у тому самому файлі). | |
| 7 | **C3**: У tests/metrics.test.ts є тести median на непарну кількість, на парну кількість і на те, що порожній перелік кидає RangeError; тести імпортують median. | |
| 8 | **C4**: Наявні функції в src/metrics.ts (зокрема mean) не змінено, а інших файлів, крім src/metrics.ts і tests/metrics.test.ts, зміна не торкається. | |

## Артефакт `t-02-1794564828130` — задача t-02

Задача: Створи новий файл tests/bm25.test.ts з тестами для функції tokenize з src/rag/bm25.ts: переводить у нижній регістр; розбиває за пунктуацією й пробілами; зберігає кирилицю й цифри; відкидає токени з одного символу. Імпорт: import { tokenize } from '../src/rag/bm25'. Сам src/rag/bm25.ts не змінюй.

Коди виходу команд приймання: `test -f tests/bm25.test.ts` → 0, `grep -q 'tokenize' tests/bm25.test.ts` → 0, `npm run typecheck` → 2, `npm test -- tests/bm25.test.ts` → 1

```diff
diff --git a/tests/bm25.test.ts b/tests/bm25.test.ts
new file mode 100644
index 0000000..4bfa11e
--- /dev/null
+++ b/tests/bm25.test.ts
@@ -0,0 +1,35 @@
+import { tokenize } from '../src/rag/bm25'
+
+describe('tokenize', () => {
+  it('should lowercase and split text', () => {
+    expect(tokenize('Hello, world!')).toEqual(['hello', 'world'])
+  })
+
+  it('should keep cyrillic and digits', () => {
+    expect(tokenize('Привет123!')).toEqual(['привет', '123'])
+  })
+
+  it('should remove single-character tokens', () => {
+    expect(tokenize('a b c.')).toEqual(['a', 'b', 'c'])
+  })
+
+  it('should handle mixed punctuation', () => {
+    expect(tokenize('!!!test###')).toEqual(['test'])
+  })
+
+  it('should handle empty input', () => {
+    expect(tokenize('')).toEqual([])
+  })
+
+  it('should handle multiple spaces', () => {
+    expect(tokenize('  test   ')).toEqual(['test'])
+  })
+
+  it('should handle unicode punctuation', () => {
+    expect(tokenize('Hello…world!')).toEqual(['hello', 'world'])
+  })
+
+  it('should ignore non-alphanumeric characters', () => {
+    expect(tokenize('abc!@#def')).toEqual(['abc', 'def'])
+  })
+})
\ No newline at end of file
```

| № | Критерій | Мій вердикт |
|---|---|---|
| 9 | **C1**: Створено файл tests/bm25.test.ts з тестами функції tokenize, який явно імпортує describe/it/expect з 'vitest' і tokenize з '../src/rag/bm25'. | |
| 10 | **C2**: Очікування в тестах відповідають справжній поведінці tokenize: нижній регістр, розбиття за пунктуацією й пробілами, кирилиця й цифри зберігаються, токени з одного символу ВІДКИДАЮТЬСЯ. | |
| 11 | **C3**: Файл src/rag/bm25.ts зміна не змінює. | |

## Артефакт `t-02-1794571544688` — задача t-02

Задача: Створи новий файл tests/bm25.test.ts з тестами для функції tokenize з src/rag/bm25.ts: переводить у нижній регістр; розбиває за пунктуацією й пробілами; зберігає кирилицю й цифри; відкидає токени з одного символу. Імпорт: import { tokenize } from '../src/rag/bm25'. Сам src/rag/bm25.ts не змінюй.

Коди виходу команд приймання: `test -f tests/bm25.test.ts` → 0, `grep -q 'tokenize' tests/bm25.test.ts` → 0, `npm run typecheck` → 0, `npm test -- tests/bm25.test.ts` → 0

```diff
diff --git a/tests/bm25.test.ts b/tests/bm25.test.ts
new file mode 100644
index 0000000..f7275b6
--- /dev/null
+++ b/tests/bm25.test.ts
@@ -0,0 +1,27 @@
+import { describe, expect, it } from 'vitest';
+
+import { tokenize } from '../src/rag/bm25';
+
+describe('tokenize', () => {
+  it('переводить у нижній регістр', () => {
+    expect(tokenize('ТЕСТ Приклад LOWERCASE')).toEqual(['тест', 'приклад', 'lowercase']);
+  });
+
+  it('розбиває за пунктуацією й пробілами', () => {
+    expect(tokenize('слово1, слово2!  слово3...\nслово4 - слово5')).toEqual([
+      'слово1',
+      'слово2',
+      'слово3',
+      'слово4',
+      'слово5',
+    ]);
+  });
+
+  it('зберігає кирилицю й цифри', () => {
+    expect(tokenize('Кирилиця 123456 та2026 цифри99')).toEqual(['кирилиця', '123456', 'та2026', 'цифри99']);
+  });
+
+  it('відкидає токени з одного символу', () => {
+    expect(tokenize('я і ти в 1 а 123')).toEqual(['ти', '123']);
+  });
+});
```

| № | Критерій | Мій вердикт |
|---|---|---|
| 12 | **C1**: Створено файл tests/bm25.test.ts з тестами функції tokenize, який явно імпортує describe/it/expect з 'vitest' і tokenize з '../src/rag/bm25'. | |
| 13 | **C2**: Очікування в тестах відповідають справжній поведінці tokenize: нижній регістр, розбиття за пунктуацією й пробілами, кирилиця й цифри зберігаються, токени з одного символу ВІДКИДАЮТЬСЯ. | |
| 14 | **C3**: Файл src/rag/bm25.ts зміна не змінює. | |

