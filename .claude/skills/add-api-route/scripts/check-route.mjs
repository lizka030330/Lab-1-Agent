#!/usr/bin/env node
// Перевіряє API-маршрут Next.js App Router: обробник, схема zod, тест.
// Використання: node scripts/check-route.mjs <назва>     (приклад: health)
// Код виходу: 0 — усе на місці, 1 — чогось бракує. Лише вбудовані модулі Node.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

const name = process.argv[2] ?? '';

if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(
    'Використання: node scripts/check-route.mjs <назва>   (малі літери, цифри, дефіси)',
  );
  process.exit(1);
}

// Корінь репозиторію — найближча тека з package.json угору від поточної.
// Тому скрипт працює і з кореня, і з теки навички.
let root = process.cwd();

while (!existsSync(join(root, 'package.json'))) {
  const parent = dirname(root);

  if (parent === root) {
    console.error(
      'Не знайдено package.json: запустіть скрипт усередині репозиторію.',
    );
    process.exit(1);
  }

  root = parent;
}

const read = (rel) =>
  existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null;

const IMPORTS_ZOD = /from\s+['"]zod(\/[^'"]*)?['"]/;

let failures = 0;

const ok = (message) => console.log(`OK    ${message}`);

const fail = (message) => {
  failures += 1;
  console.log(`FAIL  ${message}`);
};

// 1. Обробник існує і експортує HTTP-метод.
const routeRel = `app/api/${name}/route.ts`;
const route = read(routeRel);

if (route === null) {
  fail(`${routeRel} не існує`);
} else {
  ok(`${routeRel} існує`);

  if (
    /export\s+(async\s+)?(function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(
      route,
    )
  ) {
    ok('обробник експортує HTTP-метод');
  } else {
    fail(`${routeRel} не експортує GET, POST, PUT, PATCH чи DELETE`);
  }

  // 2. Схема: zod прямо в обробнику або модуль із src/, який імпортує zod.
  if (IMPORTS_ZOD.test(route)) {
    ok('обробник імпортує zod');
  } else {
    const modules = [
      ...route.matchAll(/from\s+['"](?:@\/|(?:\.\.\/)+)(src\/[^'"]+)['"]/g),
    ].map((m) => m[1]);

    const schema = modules
      .flatMap((base) => [`${base}.ts`, `${base}/index.ts`])
      .find((rel) => IMPORTS_ZOD.test(read(rel) ?? ''));

    if (schema) {
      ok(`схема zod: ${schema}`);
    } else {
      fail(`${routeRel} не імпортує ні zod, ні схему zod із src/`);
    }
  }
}

// 3. Тест існує і імпортує саме цей обробник.
const testRel = `tests/${name}.test.ts`;
const test = read(testRel);

if (test === null) {
  fail(`${testRel} не існує`);
} else if (test.includes(`app/api/${name}/route`)) {
  ok(`${testRel} імпортує обробник`);
} else {
  fail(`${testRel} не імпортує app/api/${name}/route`);
}

if (failures > 0) {
  console.log(
    `\nНе готово: проблем — ${failures}. Виправте рядки FAIL і запустіть знову.`,
  );
  process.exit(1);
}

console.log(
  '\nГотово: обробник, схема і тест на місці. Далі — npm test.',
);
