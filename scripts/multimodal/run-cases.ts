/**
 * Прогін мультимодального набору НА ЗАДЕПЛОЄНОМУ застосунку (Лаб. 4, крок 05).
 *   BASE_URL=https://<preview>.vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=<…> npx tsx scripts/multimodal/run-cases.ts
 * Без BASE_URL — проти локального `npm run dev` (http://localhost:3000). Секрет обходу захисту preview береться
 * з оточення й ніде не пишеться. Усі перевірки ДЕТЕРМІНОВАНІ — модель-суддя тут не потрібна.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type Case = { id: string; file: string; mediaType: string; ask: string; why: string; tokens_predicted?: number; expect: { kind: string; must_contain?: string; page?: number; reason?: string; status?: number; min_recall?: number } };

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const headers: Record<string, string> = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};

async function post(fd: FormData) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/multimodal`, { method: 'POST', body: fd, headers });
  const raw = await r.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = { raw: raw.slice(0, 200) }; }
  return { status: r.status, body, ms: Math.round(performance.now() - t0), vercelError: r.headers.get('x-vercel-error') };
}

function form(q: string, file?: { bytes: Buffer; type: string; name: string }) {
  const fd = new FormData();
  fd.set('question', q);
  if (file) fd.set('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  return fd;
}

async function main() {
  const cases = readFileSync('docs/lab4/multimodal-cases.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Case);
  const rows: Record<string, unknown>[] = [];
  const bases = new Map<string, number | undefined>();
  for (const c of cases) {
    const bytes = readFileSync(c.file);
    let res: Awaited<ReturnType<typeof post>>;
    if (c.expect.kind === 'roundtrip') {
      const fd = new FormData();
      fd.set('roundtrip', bytes.toString('utf8'));
      res = await post(fd);
    } else {
      res = await post(form(c.ask, { bytes, type: c.mediaType, name: c.file.split('/').pop()! }));
    }
    const b = res.body;
    let pass = false;
    let note = '';
    switch (c.expect.kind) {
      case 'answer': {
        const okText = typeof b.answer === 'string' && b.answer.toLowerCase().includes((c.expect.must_contain ?? '').toLowerCase());
        const okPage = c.expect.page === undefined || b.page === c.expect.page;
        pass = res.status === 200 && b.ok === true && okText && okPage && b.unknown !== true;
        note = `«${String(b.answer ?? b.message ?? '').slice(0, 70)}» · стор. ${String(b.page ?? '—')}`;
        break;
      }
      case 'unknown':
        pass = res.status === 200 && b.unknown === true;
        note = `«${String(b.answer ?? b.message ?? '').slice(0, 70)}»`;
        break;
      case 'rejected':
        pass = res.status === c.expect.status && b.reason === c.expect.reason;
        note = `${res.status} ${String(b.reason)}: ${String(b.message ?? '').slice(0, 80)}`;
        break;
      case 'platform413':
        pass = res.status === 413 && b.reason === undefined; // відповідь не від мого коду
        note = `${res.status} ${res.vercelError ?? ''} ${String(b.raw ?? b.message ?? '').slice(0, 60)}`;
        break;
      case 'roundtrip':
        pass = res.status === 200 && typeof b.recall === 'number' && b.recall >= (c.expect.min_recall ?? 0.8);
        note = `recall ${typeof b.recall === 'number' ? b.recall.toFixed(2) : '—'} · «${String(b.transcript ?? b.message ?? '').slice(0, 80)}»`;
        break;
    }
    let base: number | undefined;
    let diff: number | undefined;
    if (c.tokens_predicted !== undefined && res.status === 200) {
      if (!bases.has(c.ask)) bases.set(c.ask, (await post(form(c.ask))).body.inputTokens as number | undefined);
      base = bases.get(c.ask);
      const withFile = b.inputTokens as number | undefined;
      diff = base !== undefined && withFile !== undefined ? withFile - base : undefined;
    }
    const row = { id: c.id, file: c.file.split('/').pop(), why: c.why, expect: c.expect, status: res.status, pass, note, ms: res.ms, input_tokens: b.inputTokens ?? null, output_tokens: b.outputTokens ?? null, base_tokens: base ?? null, predicted: c.tokens_predicted ?? null, diff: diff ?? null, body: { ...b, voice: undefined } };
    rows.push(row);
    console.log(`${c.id} ${pass ? 'PASS' : 'FAIL'} · ${res.status} · ${res.ms} мс · ${note}${c.tokens_predicted ? ` · прогноз ${c.tokens_predicted}, різниця ${diff ?? 'не повідомлено'} (база ${base ?? 'не повідомлено'})` : ''}`);
  }
  const lat = rows.filter((r) => r.status === 200).map((r) => r.ms as number).sort((a, b) => a - b);
  const summary = { at: new Date().toISOString(), base: BASE, total: rows.length, passed: rows.filter((r) => r.pass).length, unknownExpected: rows.filter((r) => (r.expect as { kind: string }).kind === 'unknown').length, unknownOk: rows.filter((r) => (r.expect as { kind: string }).kind === 'unknown' && r.pass).length, latency_median_ms: lat[Math.floor(lat.length / 2)] ?? null, latency_max_ms: lat.at(-1) ?? null };
  mkdirSync('docs/lab4/traces/multimodal', { recursive: true });
  writeFileSync(`docs/lab4/traces/multimodal/run-${Date.now()}.json`, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  console.log(`\nпройдено ${summary.passed}/${summary.total} · «не знаю» де очікувалось: ${summary.unknownOk}/${summary.unknownExpected} · затримка медіана ${summary.latency_median_ms} мс, найгірша ${summary.latency_max_ms} мс`);
}

await main();
