// src/otel/langfuse.ts — один процесор на весь процес (Next.js бандлить instrumentation і route окремо)
import { isDefaultExportSpan, LangfuseSpanProcessor } from '@langfuse/otel';

const g = globalThis as typeof globalThis & { __langfuseSpanProcessor?: LangfuseSpanProcessor };

export const langfuseSpanProcessor = (g.__langfuseSpanProcessor ??= new LangfuseSpanProcessor({
  exportMode: 'immediate', // serverless: кожен спан відправляється одразу, а не батчем
  // типовий фільтр пропускає лише спани AI SDK / LLM-інструментацій; корінний спан прогону — наш (крок 06 Лаб. 4)
  shouldExportSpan: ({ otelSpan }) => isDefaultExportSpan(otelSpan) || otelSpan.instrumentationScope.name === 'lab4-app',
}));
