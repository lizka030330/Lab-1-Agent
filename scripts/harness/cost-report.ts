/**
 * Таблиці docs/lab4/cost.md (Лаб. 4, крок 07) — генеруються із записів, а не набираються руками.
 *   npx tsx scripts/harness/cost-report.ts docs/lab4/traces > docs/lab4/cost-table.md
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { summarise, taskRow, TASK_TABLE_HEADER, type TaskCost } from './cost';

const dir = process.argv[2] ?? 'docs/lab4/traces';
const files = readdirSync(dir).filter((f) => f.startsWith('cost-') && f.endsWith('.jsonl')).sort();
const load = (f: string) =>
  readFileSync(join(dir, f), 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as TaskCost);

console.log('<!-- згенеровано: npx tsx scripts/harness/cost-report.ts ' + dir + ' -->');
console.log('\n### Зведення конфігурацій\n');
console.log('| Конфігурація | Задач | Пройдено | Частка | Підняттів | Вхід (повідомл.) | Кеш-читання (повідомл.) | Кеш-запис (повідомл.) | Вихід | Reasoning | Кроків | Інстр. | Повторів | Час, с | $ OpenCode | Токенів на пройдену | $ на пройдену |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const f of files) {
  const s = summarise(load(f));
  const name = f.replace(/^cost-|\.jsonl$/g, '');
  console.log(`| ${name} | ${s.tasks} | ${s.passed} | ${(s.pass_share * 100).toFixed(0)}% | ${s.escalations} | ${s.input_tokens} (${s.input_reported}) | ${s.cache_read} (${s.cache_read_reported}) | ${s.cache_write} (${s.cache_write_reported}) | ${s.output_tokens} (${s.output_reported}) | ${s.reasoning_tokens} (${s.reasoning_reported}) | ${s.steps} | ${s.tool_calls} | ${s.retries} | ${s.duration_s} | ${s.cost_usd} (${s.cost_reported}) | ${s.tokens_per_passed ?? 'немає пройдених'} | ${s.usd_per_passed ?? '—'} |`);
}
for (const f of files) {
  const rows = load(f);
  console.log(`\n### ${f.replace(/^cost-|\.jsonl$/g, '')} — задача за задачею\n`);
  console.log(TASK_TABLE_HEADER);
  for (const r of rows) console.log(taskRow(r));
  const titles = rows.reduce((a, r) => a + r.title_calls, 0);
  console.log(`\nСлужбових викликів моделі заголовка (\`agent=title\`): ${titles} — їхні токени OpenCode у подіях кроків не повідомляє.`);
}
