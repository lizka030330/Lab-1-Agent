/**
 * Калібрування судді (Лаб. 3, крок 05). Один суддя на вимір, окремий запит на кожен випадок і вимір.
 * Суддя бачить лише докази з артефакта, рубрику «після» ітерації і текст задачі. Мої мітки і попередні вердикти він не бачить.
 *
 *   npx tsx scripts/judge/calibrate.ts
 *
 * Модель: OLLAMA_BASE_URL (за замовчуванням http://localhost:11434) і VERIFY_HARNESS_MODEL (за замовчуванням qwen3-8b-16k).
 * Вердикти — docs/lab3/verdicts/judge.jsonl (перезаписується). Числа друкуються в консоль.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { z } from 'zod';

import { chatCompletionsModel } from '../../src/agent/adapters';
import { filterDiff, findSecret } from '../../src/verify/verify';
import { agreement, confusion, LABELS, type Label } from '../kappa';

const DIMS = ['acceptance_met', 'scope_respected', 'reason_stated'] as const;
type Dim = (typeof DIMS)[number];

interface Case { case_id: string; artifact: string; dimension: Dim; mine: Label; holdout: boolean }
interface Task { id: string; input: string; acceptance: string[]; files: string[] }

const readJsonl = <T,>(p: string): T[] =>
  readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as T);

const cases = readJsonl<Case>('docs/lab3/judge-cases.jsonl');
const tasks = new Map(readJsonl<Task>('docs/lab3/tasks.jsonl').map((t) => [t.id, t]));
const rubric = readFileSync('docs/lab3/judge-rubric-after.md', 'utf8');

const model = chatCompletionsModel({
  url: `${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/v1/chat/completions`,
  model: process.env.VERIFY_HARNESS_MODEL || 'qwen3-8b-16k',
});
const MODEL_NAME = process.env.VERIFY_HARNESS_MODEL || 'qwen3-8b-16k';

const verdictSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'unknown']),
  reason: z.string().min(1),
  evidence: z.string(),
});

/** Секція рубрики для одного виміру. */
function rubricFor(dim: Dim): string {
  const m = rubric.match(new RegExp(`## ${dim}\\n([\\s\\S]*?)(?=\\n## |$)`));
  if (!m) throw new Error(`немає секції рубрики: ${dim}`);
  return (m[1] ?? "").trim();
}

/** Останній текстовий блок агента з output.txt (події JSON по рядках). */
function finalText(path: string): string {
  let last = '';
  if (!existsSync(path)) return last;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { continue; }
    const visit = (o: unknown): void => {
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        if (r.type === 'text' && typeof r.text === 'string') last = r.text;
        for (const v of Object.values(r)) visit(v);
      }
    };
    visit(ev);
  }
  return last;
}

function evidenceFor(c: Case, dim: Dim): string {
  const dir = c.artifact;
  const task = tasks.get(basename(dir).split('-').slice(0, 2).join('-'));
  if (!task) throw new Error(`немає задачі для ${dir}`);
  const run = JSON.parse(readFileSync(`${dir}/run.json`, 'utf8')) as Record<string, unknown>;
  if (dim === 'acceptance_met') {
    return [
      `Задача: ${task.input}`,
      `Команди приймання з задачі: ${JSON.stringify(task.acceptance)}`,
      `run.json: exit_status=${String(run.exit_status)}, acceptance_passed=${String(run.acceptance_passed)}`,
      `run.json.acceptance: ${JSON.stringify(run.acceptance ?? null)}`,
    ].join('\n');
  }
  if (dim === 'scope_respected') {
    const patch = readFileSync(`${dir}/patch.diff`, 'utf8');
    if (findSecret(patch)) throw new Error(`схоже на ключ у ${dir}/patch.diff — не відправляю`);
    return [
      `Задача: ${task.input}`,
      `Перелік files задачі: ${JSON.stringify(task.files)}`,
      `patch.diff (${patch.length} байтів):`,
      filterDiff(patch).slice(0, 8000) || '(патч порожній)',
    ].join('\n');
  }
  const text = finalText(`${dir}/output.txt`);
  return [
    `Задача: ${task.input}`,
    `run.json: exit_status=${String(run.exit_status)}, acceptance_passed=${String(run.acceptance_passed)}`,
    text ? `Фінальний текст агента:\n${text.slice(0, 3000)}` : '(фінального тексту агента немає)',
  ].join('\n');
}

const SYSTEM = [
  'Ти — незалежний суддя. Оцінюєш ОДИН вимір артефакта за рубрикою. Лише докази, без припущень.',
  'Відповідай ЛИШЕ JSON: {"verdict":"pass"|"fail"|"unknown","reason":"одне речення","evidence":"факт або цитата з доказів"}.',
].join('\n');

function parseVerdict(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const r = verdictSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return r.success ? r.data : null;
  } catch { return null; }
}

async function judge(c: Case, dim: Dim) {
  const prompt = `Рубрика для ${dim}:\n${rubricFor(dim)}\n\nДокази:\n${evidenceFor(c, dim)}\n\nПоверни лише JSON.`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = attempt === 1 ? prompt : `${prompt}\n\nПопередня відповідь не відповідала схемі. Поверни лише JSON за схемою.`;
    const turn = await model(SYSTEM, [{ role: 'user', text }], []);
    const v = parseVerdict(turn.text);
    if (v) return v;
  }
  throw new Error(`невалідний JSON двічі: ${c.case_id} ${dim} (${c.artifact})`);
}

async function main() {
  const out: string[] = [];
  for (const c of cases) {
    const v = await judge(c, c.dimension);
    out.push(JSON.stringify({
      case_id: c.case_id, artifact: c.artifact, dimension: c.dimension,
      verdict: v.verdict, reason: v.reason, evidence: v.evidence,
      model: MODEL_NAME, order: 'n/a', at: new Date().toISOString(),
    }));
    console.log(`${c.case_id} ${c.dimension} → ${v.verdict}`);
  }
  mkdirSync(dirname('docs/lab3/verdicts/judge.jsonl'), { recursive: true });
  writeFileSync('docs/lab3/verdicts/judge.jsonl', out.join('\n') + '\n');

  const verdicts = readJsonl<{ case_id: string; dimension: Dim; verdict: Label }>('docs/lab3/verdicts/judge.jsonl');
  const byKey = new Map(verdicts.map((v) => [`${v.case_id}|${v.dimension}`, v.verdict]));
  const report = (label: string, subset: Case[]) => {
    const pairs = subset.filter((c) => byKey.has(`${c.case_id}|${c.dimension}`));
    if (pairs.length === 0) return console.log(`${label}: немає вердиктів`);
    const mine = pairs.map((c) => c.mine);
    const judge = pairs.map((c) => byKey.get(`${c.case_id}|${c.dimension}`)!);
    const a = agreement(mine, judge);
    const m = confusion(mine, judge);
    console.log(`\n== ${label} · n=${a.n}`);
    console.log(`сира згода ${a.raw.toFixed(3)} · очікувана ${a.expected.toFixed(3)} · каппа ${Number.isNaN(a.kappa) ? 'не визначена' : a.kappa.toFixed(3)}`);
    console.log('рядок = мій, стовпець = суддя:', LABELS.join(' '));
    for (const r of LABELS) console.log(`  ${r.padEnd(8)} ${LABELS.map((x) => String(m[r][x]).padStart(4)).join('')}`);
    console.log(`  пропускає погане (мій fail → суддя pass): ${m.fail.pass}`);
    console.log(`  марна робота   (мій pass → суддя fail): ${m.pass.fail}`);
  };
  for (const d of DIMS) {
    report(`${d} · усі`, cases.filter((c) => c.dimension === d));
    report(`${d} · робочі`, cases.filter((c) => c.dimension === d && !c.holdout));
    report(`${d} · ВІДКЛАДЕНІ`, cases.filter((c) => c.dimension === d && c.holdout));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
