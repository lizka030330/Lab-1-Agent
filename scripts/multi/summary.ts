/**
 * Зводить дві колонки «один агент проти розгалуження» для docs/lab4/multiagent.md з трас docs/lab4/traces/multi/*.json.
 *
 *   npx tsx scripts/multi/summary.ts single-v3 fanout-v3
 *
 * Для кожної мітки береться ОСТАННЯ траса кожного питання. Медіана — для часу до відповіді; суми — для решти.
 * Токени, яких провайдер не повідомив, у сумах не ховаються: окремий рядок «ходів без токенів».
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Rec = {
  question_id: string; label: string; at: string; wall_ms: number; fanout_wall_ms: number; compute_ms: number; verifier_ms: number;
  calls: number; steps: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; unreported_calls: number;
  usd_estimate: number; quality_facts: number; claims_total: number; claims_pass: number; blocked: boolean; stop: string;
};

const DIR = 'docs/lab4/traces/multi';
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : ((s[m - 1]! + s[m]!) / 2);
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function latest(label: string): Rec[] {
  const recs = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Rec).filter((r) => r.label === label);
  const by = new Map<string, Rec>();
  for (const r of recs) if (!by.has(r.question_id) || by.get(r.question_id)!.at < r.at) by.set(r.question_id, r);
  return [...by.values()].sort((a, b) => a.question_id.localeCompare(b.question_id));
}

function column(rs: Rec[]) {
  return {
    n: rs.length,
    wallMedianS: median(rs.map((r) => r.wall_ms)) / 1000,
    readMedianS: median(rs.map((r) => r.fanout_wall_ms)) / 1000,
    computeS: sum(rs.map((r) => r.compute_ms)) / 1000,
    input: sum(rs.map((r) => r.input_tokens)),
    output: sum(rs.map((r) => r.output_tokens)),
    cache: sum(rs.map((r) => r.cache_read_tokens)),
    calls: sum(rs.map((r) => r.calls)),
    steps: sum(rs.map((r) => r.steps)),
    unreported: sum(rs.map((r) => r.unreported_calls)),
    facts: sum(rs.map((r) => r.quality_facts)) / rs.length,
    claims: `${sum(rs.map((r) => r.claims_pass))}/${sum(rs.map((r) => r.claims_total))}`,
    blocked: rs.filter((r) => r.blocked).length,
    usd: sum(rs.map((r) => r.usd_estimate)),
  };
}

function main() {
  const [a = 'single-v3', b = 'fanout-v3'] = process.argv.slice(2);
  const A = latest(a);
  const B = latest(b);
  const ca = column(A);
  const cb = column(B);
  const f = (x: number, d = 1) => x.toFixed(d);
  const rows: [string, string, string][] = [
    ['питань', String(ca.n), String(cb.n)],
    ['час ДО ВІДПОВІДІ (усе питання, з верифікатором), медіана, с', f(ca.wallMedianS), f(cb.wallMedianS)],
    ['час фази читання (до fan-in), медіана, с', f(ca.readMedianS), f(cb.readMedianS)],
    ['сумарний час обчислення Gemini + верифікатор, с', f(ca.computeS), f(cb.computeS)],
    ['вхідні токени Gemini, сума', String(ca.input), String(cb.input)],
    ['  з них кешованих (де повідомлено)', String(ca.cache), String(cb.cache)],
    ['вихідні токени Gemini, сума', String(ca.output), String(cb.output)],
    ['ходів (викликів моделі), разом з упалими й верифікатором', String(ca.calls), String(cb.calls)],
    ['HTTP-запитів до Gemini (кроків)', String(ca.steps), String(cb.steps)],
    ['ходів без токенів («не повідомлено»)', String(ca.unreported), String(cb.unreported)],
    ['якість: частка еталонних фактів у відповіді, середнє', f(ca.facts, 2), f(cb.facts, 2)],
    ['якість: твердження pass у верифікатора', ca.claims, cb.claims],
    ['питань, заблокованих верифікатором', String(ca.blocked), String(cb.blocked)],
    ['вартість Gemini, USD (оцінка за src/cost.ts)', f(ca.usd, 4), f(cb.usd, 4)],
  ];
  console.log(`| Вимір | один агент (${a}) | розгалуження (${b}) |\n|---|---|---|`);
  for (const [k, x, y] of rows) console.log(`| ${k} | ${x} | ${y} |`);
  console.log('\nПо питаннях:');
  for (const r of [...A, ...B]) console.log(`${r.label} ${r.question_id}: ${(r.wall_ms / 1000).toFixed(1)} с · ходів ${r.calls} · кроків ${r.steps} · ${r.input_tokens}/${r.output_tokens} · факти ${r.quality_facts.toFixed(2)} · ${r.claims_pass}/${r.claims_total} · ${r.blocked ? 'блок' : 'ok'} · stop=${r.stop}`);
}

if (process.argv[1]?.endsWith('summary.ts')) main();
