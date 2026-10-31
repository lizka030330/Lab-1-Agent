/**
 * Траса прогону еталонного набору в Langfuse (крок 06) — без SDK, через публічний
 * ingestion API: адаптер циклу з Лаб. 1 ходить у модель напряму (fetch), тож
 * автоматичної телеметрії AI SDK тут немає. Одна траса на прогін, одна generation на запит
 * з токенами й вартістю за прайсом src/models.ts (на безкоштовному рівні факт — $0).
 */
import { randomUUID } from 'node:crypto';

export interface TracedCall {
  readonly name: string;
  readonly model: string;
  readonly input: string;
  readonly output: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
}

/** Повертає id траси або null, якщо ключів Langfuse немає (тоді нічого не відправляє). */
export async function sendTrace(name: string, metadata: Record<string, unknown>, calls: readonly TracedCall[]): Promise<string | null> {
  const pk = process.env.LANGFUSE_PUBLIC_KEY;
  const sk = process.env.LANGFUSE_SECRET_KEY;
  const base = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
  if (!pk || !sk) return null;

  const traceId = randomUUID();
  const now = new Date().toISOString();
  const batch = [
    { id: randomUUID(), type: 'trace-create', timestamp: now, body: { id: traceId, name, timestamp: calls[0]?.startTime ?? now, metadata } },
    ...calls.map((c) => ({
      id: randomUUID(),
      type: 'generation-create',
      timestamp: c.endTime,
      body: {
        id: randomUUID(),
        traceId,
        name: c.name,
        model: c.model,
        input: c.input,
        output: c.output,
        startTime: c.startTime,
        endTime: c.endTime,
        usageDetails: { input: c.inputTokens, output: c.outputTokens },
        costDetails: { input: c.inputCostUsd, output: c.outputCostUsd, total: c.inputCostUsd + c.outputCostUsd },
      },
    })),
  ];
  const res = await fetch(`${base}/api/public/ingestion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${pk}:${sk}`).toString('base64')}` },
    body: JSON.stringify({ batch }),
  });
  const body = (await res.json().catch(() => ({}))) as { errors?: unknown[] };
  if (!res.ok || (body.errors?.length ?? 0) > 0) {
    throw new Error(`Langfuse ingestion ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return traceId;
}
