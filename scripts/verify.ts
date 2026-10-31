/**
 * Брама верифікатора (Лаб. 2, крок 03). ХОДИТЬ У МЕРЕЖУ. Запуск перед злиттям у main:
 *
 *   git diff main...HEAD > docs/lab2/verify-input.diff
 *   npm run verify                      # усі критерії A1–A8
 *   npm run verify -- --only A3,A4      # лише вибрані (калібрування)
 *
 * Суддя — модель ІНШОГО провайдера, ніж автор коду: код Лаб. 2 писав Claude (Anthropic),
 * суддя — Gemini (Google) через адаптер chatCompletionsModel з Лаб. 1. Модель — VERIFY_MODEL.
 * Код виходу 1, якщо хоч один критерій fail (unknown браму не валить). Звіт — docs/lab2/verify-report.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { chatCompletionsModel } from '../src/agent/adapters';
import { isBlocked, verifyReport } from '../src/verify/schema';
import { filterDiff, findSecret, parseCriteria, reportTable, verifyDiff } from '../src/verify/verify';

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? '').split(',').filter(Boolean) : [];
const file = args.find((a, i) => !a.startsWith('--') && i !== onlyIdx + 1) ?? 'docs/lab2/verify-input.diff';

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY порожній: заповніть .env.local (локально) або секрет репозиторію (CI)');
const modelId = process.env.VERIFY_MODEL ?? 'gemini-3.5-flash-lite';

const diff = filterDiff(readFileSync(file, 'utf8'));
if (diff.trim() === '') {
  console.log('diff порожній — перевіряти нічого');
  process.exit(0);
}
const secret = findSecret(diff);
if (secret) throw new Error(`у diff схоже на ключ (${secret}…) — не відправляю`);

const criteria = parseCriteria(readFileSync('docs/lab2/spec.md', 'utf8')).filter(
  (c) => only.length === 0 || only.includes(c.id),
);
if (criteria.length === 0) throw new Error('не знайдено критеріїв приймання в docs/lab2/spec.md');

const model = chatCompletionsModel({
  url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  model: modelId,
  headers: { authorization: `Bearer ${key}` },
});

console.log(`Суддя: ${modelId} (Google); критеріїв: ${criteria.length}; diff: ${file}, ${diff.length} симв.\n`);
const report = verifyReport.parse(await verifyDiff(model, criteria, diff, Number(process.env.VERIFY_PAUSE_MS) || 0));
writeFileSync('docs/lab2/verify-report.json', `${JSON.stringify({ model: modelId, file, ...report }, null, 2)}\n`, 'utf8');
console.log(reportTable(report));

if (isBlocked(report)) {
  console.error('\nБРАМА: є fail — зміну не зливати.');
  process.exit(1);
}
console.log('\nБРАМА: fail немає — можна зливати.');
