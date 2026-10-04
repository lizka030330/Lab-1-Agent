import { after } from 'next/server';
import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { langfuseSpanProcessor } from '@/src/otel/langfuse';
import { CATALOG } from '@/src/models';

export const maxDuration = 60; // Hobby: максимум 300 с

const agent = new ToolLoopAgent({
  model: google(CATALOG['gemini-3.8-flash'].id), // дешева Flash-модель із безкоштовним рівнем
  instructions: 'Для поточного часу використовуй інструмент getTime.',
  tools: {
    getTime: tool({
      description: 'Поточний час сервера (ISO 8601)',
      inputSchema: z.object({}),
      execute: async () => ({ now: new Date().toISOString() }),
    }),
  },
  stopWhen: isStepCount(3), // мінімальний запобіжник: не більше трьох кроків на запит
  telemetry: { functionId: 'lab01-agent' },
});

export async function POST(req: Request) {
  // Реєструємо ДО виклику моделі: after() спрацює і тоді, коли обробник кинув помилку.
  after(async () => {
    await langfuseSpanProcessor.forceFlush();
  });

  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  const prompt = typeof body.prompt === 'string' ? body.prompt : 'Котра зараз година?';

  try {
    const result = await agent.generate({ prompt });
    return Response.json({ text: result.text, usage: result.usage });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}