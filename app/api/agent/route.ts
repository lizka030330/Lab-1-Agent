import { after } from 'next/server';
import { ToolLoopAgent, tool, isStepCount, type LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { recordUsage } from '@/src/budget';
import { guard } from '@/src/guard';
import { json } from '@/src/http';
import { langfuseSpanProcessor } from '@/src/otel/langfuse';
import { aiTelemetry, newTaskId, withTaskSpan } from '@/src/telemetry';
import { CATALOG } from '@/src/models';

export const maxDuration = 60; // Hobby: максимум 300 с

/**
 * Модель за змінною LLM_PROVIDER: 'openrouter' — безкоштовна модель шлюзу (запасний варіант
 * з методички, коли денна квота Gemini вичерпана); інакше — gemini-3.8-flash.
 */
function pickModel(): LanguageModel {
  const key = process.env.OPENROUTER_API_KEY;
  const id = process.env.OPENROUTER_MODEL;
  if (process.env.LLM_PROVIDER === 'openrouter' && key && id) {
    return createOpenAICompatible({ name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: key })(id);
  }
  return google(CATALOG['gemini-3.8-flash'].id);
}

/** Агент створюється на запит: functionId (= id задачі) у кожного прогону свій. */
function makeAgent(taskId: string) {
  return new ToolLoopAgent({
    model: pickModel(),
    instructions: 'Для поточного часу використовуй інструмент getTime.',
    tools: {
      getTime: tool({
        description: 'Поточний час сервера (ISO 8601)',
        inputSchema: z.object({}),
        execute: async () => ({ now: new Date().toISOString() }),
      }),
    },
    stopWhen: isStepCount(3), // не більше трьох кроків на запит
    telemetry: aiTelemetry(taskId),
  });
}

export async function POST(req: Request) {
  // Реєструємо ДО виклику моделі: after() спрацює і тоді, коли обробник кинув помилку.
  after(async () => {
    await langfuseSpanProcessor.forceFlush();
  });

  const gate = await guard(['agent']);
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 2000) : 'Котра зараз година?';
  const taskId = newTaskId('agent');

  return withTaskSpan('lab4-agent', taskId, async (traceId) => {
    try {
      const result = await makeAgent(taskId).generate({ prompt });
      await recordUsage(gate.store, result.totalUsage).catch(() => undefined);
      return json({ ok: true, task_id: taskId, trace_id: traceId, text: result.text, usage: result.totalUsage }, 200);
    } catch (error) {
      return json({ ok: false, task_id: taskId, trace_id: traceId, error: 'model', message: error instanceof Error ? error.message.slice(0, 300) : String(error) }, 502);
    }
  });
}
