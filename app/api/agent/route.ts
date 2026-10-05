import { after } from 'next/server';
import { ToolLoopAgent, tool, isStepCount, type LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { z } from 'zod';
import { langfuseSpanProcessor } from '@/src/otel/langfuse';
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
  return google(CATALOG['gemini-3.8-flash'].id); // дешева Flash-модель із безкоштовним рівнем
}

const agent = new ToolLoopAgent({
  model: pickModel(),
  instructions: 'Для поточного часу використовуй інструмент getTime.',
  tools: {
    getTime: tool({
      description: 'Поточний час сервера (ISO 8601)',
      inputSchema: z.object({}),
      execute: async () => ({ now: new Date().toISOString() }),
    }),
  },
  stopWhen: isStepCount(3), // мінімальний запобіжник: не більше трьох кроків на запит
  // Інтеграцію передаємо прямо тут: instrumentation і route — окремі бандли з окремими копіями `ai`,
  // тому registerTelemetry() з instrumentation.node.ts маршрут не бачить і телеметрія лишалась вимкненою.
  telemetry: {
    functionId: 'lab01-agent',
    isEnabled: true,
    integrations: [new LangfuseVercelAiSdkIntegration()],
  },
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