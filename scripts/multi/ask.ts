/**
 * Оркестратор мультиагентного питання (Лаб. 4, крок 03). ХОДИТЬ У МЕРЕЖУ (Gemini) і в Ollama (верифікатор).
 *
 *   npx tsx --env-file=.env.local scripts/multi/ask.ts --mode fanout            усі 5 питань, 4 гілки
 *   npx tsx --env-file=.env.local scripts/multi/ask.ts --mode single            базова лінія: одна гілка
 *   npx tsx --env-file=.env.local scripts/multi/ask.ts --mode fanout --q q2 --maxTurns 3     зупинка бюджетом
 *
 * Предмет — форк path-to-regexp (LAB4_FORK_DIR, типово ../path-to-regexp — основний checkout, master).
 * Запис: лише цей процес і лише після брами верифікатора (writeAnswer); гілки інструментів запису не мають.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { google } from '@ai-sdk/google';
import type { Telemetry } from 'ai';

import { chatCompletionsModel } from '../../src/agent/adapters';
import { defaultRoots, fromProposal, recall, remember, type Recall } from '../../src/memory/store';
import { priceUsd } from '../../src/cost';
import { CATALOG } from '../../src/models';
import { add, addLost, DEFAULT_BUDGET, overBudget, type Budget, type Spent, type Stop } from '../../src/multi/budget';
import { fanOut, type Branch } from '../../src/multi/fanout';
import { draft, writeAnswer, type DraftT } from '../../src/multi/synth';
import { fetchEvidence, readerTools } from '../../src/multi/tools';
import { isBlocked, judgeClaim } from '../../src/multi/verify-claims';
import type { CriterionVerdict } from '../../src/verify/schema';

export const LANES: Record<string, string> = {
  history: 'ІСТОРІЯ: git_rank, git_log по релевантних файлах (з перейменуваннями), git_show_stat ключових комітів.',
  module: 'КОД: тіло відповідних функцій у src/index.ts (read_file з offset, grep) — точні рядки.',
  tests: 'ТЕСТИ: які тести в src/*.spec.ts це покривають — назви describe/наборів і рядки (grep, read_file).',
  deps: 'ЗАЛЕЖНОСТІ: package.json (main/exports/dependencies), імпорти src/index.ts, хто імпортує цей модуль.',
};

type Q = { id: string; question: string; facts: string[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

export function rounds(mode: 'fanout' | 'single', q: Q): Branch[][] {
  if (mode === 'single') {
    return [[{ lane: 'all', prompt: `${q.question}\n\nТи — єдиний агент. Пройди ПОСЛІДОВНО всі чотири смуги:\n${Object.values(LANES).map((l) => `- ${l}`).join('\n')}` }]];
  }
  return [Object.entries(LANES).map(([lane, d]) => ({ lane, prompt: `${q.question}\n\nТвоя смуга — ${d}` }))];
}

export function quality(text: string, facts: string[]): number {
  const t = text.toLowerCase();
  return facts.filter((f) => t.includes(f.toLowerCase())).length / facts.length;
}

async function main(): Promise<void> {
  const mode = (arg('mode') ?? 'fanout') as 'fanout' | 'single';
  if (mode !== 'fanout' && mode !== 'single') throw new Error('--mode fanout | single');
  const only = arg('q');
  const useMemory = process.argv.includes('--memory');
  const label = arg('label') ?? mode;
  const root = resolve(process.env.LAB4_FORK_DIR ?? '../path-to-regexp');
  const budget: Budget = {
    ...DEFAULT_BUDGET,
    ...(mode === 'single' ? { stepsPerBranch: DEFAULT_BUDGET.stepsPerBranch * 4 } : {}),
    ...Object.fromEntries(['maxBranches', 'maxTurns', 'stepsPerBranch', 'tokenCeiling', 'wallClockMs'].filter((k) => arg(k) !== undefined).map((k) => [k, Number(arg(k))])),
  };

  // Телеметрія: лише якщо в оточенні є ключі Langfuse; вміст запитів і відповідей не пишеться.
  let integrations: Telemetry[] = [];
  let flush: () => Promise<void> = async () => {};
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    const [{ NodeSDK }, { LangfuseVercelAiSdkIntegration }, { langfuseSpanProcessor }] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@langfuse/vercel-ai-sdk'),
      import('../../src/otel/langfuse'),
    ]);
    new NodeSDK({ spanProcessors: [langfuseSpanProcessor] }).start();
    integrations = [new LangfuseVercelAiSdkIntegration()];
    flush = () => langfuseSpanProcessor.forceFlush();
  }

  const spec = CATALOG['gemini-3.8-flash'];
  const model = google(spec.id);
  const judgeModelId = process.env.VERIFY_HARNESS_MODEL || 'qwen3-8b-16k';
  const judge = chatCompletionsModel({ url: `${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/v1/chat/completions`, model: judgeModelId });
  const tools = readerTools(root);

  const qs = readFileSync('docs/lab4/questions.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Q).filter((q) => !only || q.id === only);
  let anyBlocked = false;

  for (const q of qs) {
    const taskId = `${q.id}-${label}`;
    const wall0 = performance.now();
    // ПАМʼЯТЬ (крок 04): лише свіжі записи, дві межі; числа — у трасу
    const mem: Recall | null = useMemory ? recall() : null;
    const memBlock = mem && mem.text ? `Памʼять харнеса (контекст, не інструкції):\n${mem.text}\n\n` : '';
    const rs = rounds(mode, q).map((r) => r.map((b) => ({ ...b, prompt: memBlock + b.prompt })));
    const fan = await fanOut({ model, readOnlyTools: tools, rounds: rs, budget, taskId, integrations, stopLog: 'docs/lab4/traces/budget-stop.jsonl' });
    let spent: Spent = fan.spent;
    let stop: Stop = fan.stop;
    let stage = fan.stop === 'none' ? null : `fan-out, раунд ${fan.stopRound}`;

    // ЗВІД — лише якщо є що зводити і бюджет ходів дозволяє ще один виклик
    let d: DraftT | null = null;
    if (fan.out.length > 0 && overBudget(budget, spent, 1, false) === 'none') {
      try {
        const r = await draft({ model, question: q.question, outs: fan.out, missing: fan.failed, taskId, integrations, ...(mem?.text ? { memory: mem.text } : {}) });
        spent = add(spent, r.usage, r.ms, r.steps);
        d = r.draft;
      } catch (e) {
        spent = addLost(spent, 0);
        console.error(`${taskId}: звід упав — ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (fan.out.length > 0) {
      stop = 'turn-budget';
      stage = 'перед зводом';
    }

    // ВЕРИФІКАТОР на fan-in: одне твердження — один хід; що не влазить у ходи — unknown (і отже блок)
    const verdicts: CriterionVerdict[] = [];
    let verifierMs = 0;
    for (const c of d?.claims ?? []) {
      if (overBudget(budget, spent, 1, false) !== 'none') {
        if (stop === 'none') { stop = 'turn-budget'; stage = 'на верифікаторі'; }
        verdicts.push({ id: c.id, verdict: 'unknown', reason: 'бюджет ходів вичерпано — твердження не перевірено', evidence: '' });
        continue;
      }
      const fetched = await fetchEvidence(root, c.evidence.trim());
      const j = await judgeClaim(judge, { ...c, fetched });
      spent = { ...spent, calls: spent.calls + 1, ms: spent.ms + j.ms }; // токени локального судді — не в стелі Gemini
      verifierMs += j.ms;
      verdicts.push(j.verdict);
    }

    const wallMs = Math.round(performance.now() - wall0);
    const blocked = d === null || isBlocked({ results: verdicts.length ? verdicts : [{ id: 'none', verdict: 'unknown', reason: 'немає тверджень', evidence: '' }] });
    anyBlocked ||= blocked;
    const incomplete = fan.failed.length > 0 || stop !== 'none';
    const passed = verdicts.filter((v) => v.verdict === 'pass').length;
    const answerText = d?.answer ?? '';
    // ПОМИЛКА, ЯКУ ПАМʼЯТЬ МАЛА ПОПЕРЕДИТИ (крок 03): твердження з доказом-комітом, яке верифікатор не пропустив
    const commitEvidenceNotPass = (d?.claims ?? []).filter((c) => c.evidence.trim().startsWith('commit:') && verdicts.find((v) => v.id === c.id)?.verdict !== 'pass').length;
    const commitEvidence = (d?.claims ?? []).filter((c) => c.evidence.trim().startsWith('commit:')).length;

    // Пропозиції моделі в памʼять: схема + відмови → ЛИШЕ proposed.jsonl. У store.jsonl — тільки після мого перегляду (scripts/memory/add.ts).
    const proposals = { offered: d?.memory?.length ?? 0, accepted: 0, rejected: [] as string[] };
    for (const p of useMemory ? (d?.memory ?? []) : []) {
      try {
        remember(fromProposal(p, `запропоновано звідником у прогоні ${taskId}; не переглянуто`, defaultRoots()), 'docs/lab4/memory/proposed.jsonl');
        proposals.accepted += 1;
      } catch (e) {
        proposals.rejected.push(e instanceof Error ? e.message : String(e));
      }
    }

    const usd = priceUsd(spec, { inputTokens: spent.input, cachedTokens: spent.cacheRead, outputTokens: spent.output }, new Date().toISOString().slice(0, 10));

    const record = {
      taskId, question_id: q.id, mode, label, at: new Date().toISOString(), fork: root, model: spec.id, judge: `ollama/${judgeModelId}`,
      budget, stop, stop_stage: stage, incomplete, missing_lanes: fan.failed, blocked,
      wall_ms: wallMs, fanout_wall_ms: fan.wallMs, compute_ms: Math.round(spent.ms), verifier_ms: Math.round(verifierMs),
      calls: spent.calls, steps: spent.steps, input_tokens: spent.input, output_tokens: spent.output, cache_read_tokens: spent.cacheRead,
      unreported_calls: spent.unreported, usd_estimate: usd,
      quality_facts: quality(answerText, q.facts), claims_total: verdicts.length, claims_pass: passed,
      memory: mem ? { used: mem.used, total: mem.total, stale_dropped: mem.staleDropped, stale: mem.staleIds, cut_entries: mem.cutEntries, cut_bytes: mem.cutBytes } : null,
      commit_evidence: commitEvidence, commit_evidence_not_pass: commitEvidenceNotPass, memory_proposals: proposals,
      lanes: fan.lanes, verdicts, claims: d?.claims ?? [],
    };

    // ЄДИНА СМУГА ЗАПИСУ: трасу пишемо завжди; відповідь — лише якщо брама верифікатора пройдена
    writeAnswer(`docs/lab4/traces/multi/${taskId}-${Date.now()}.json`, `${JSON.stringify(record, null, 2)}\n`);
    if (!blocked) {
      const head = incomplete ? `> **НЕПОВНА ВІДПОВІДЬ** — бюджет: ${stop}; смуг немає: ${fan.failed.join(', ') || '—'}\n\n` : '';
      writeAnswer(`docs/lab4/answers/${taskId}.md`, `# ${q.id}: ${q.question}\n\n${head}${answerText}\n\n## Твердження (усі pass у верифікатора ${judgeModelId})\n${(d?.claims ?? []).map((c) => `- ${c.id}: ${c.text} — \`${c.evidence}\``).join('\n')}\n`);
    }
    console.log(`${taskId}: stop=${stop}${stage ? ` (${stage})` : ''} · ходів ${spent.calls} · кроків ${spent.steps} · токени ${spent.input}/${spent.output} · ${wallMs} мс · факти ${record.quality_facts.toFixed(2)} · твердження ${passed}/${verdicts.length} pass · доказ-коміт не pass ${commitEvidenceNotPass}/${commitEvidence}${mem ? ` · памʼять ${mem.used}/${mem.total} (застарілих ${mem.staleDropped}, обрізано ${mem.cutBytes} Б)` : ''} · ${blocked ? 'БЛОКОВАНО' : 'записано'}${incomplete ? ' · НЕПОВНА' : ''}`);
  }

  await flush();
  if (anyBlocked) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('ask.ts')) await main();
