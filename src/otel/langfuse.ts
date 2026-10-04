// src/otel/langfuse.ts — один процесор на весь процес (Next.js бандлить instrumentation і route окремо)
import { LangfuseSpanProcessor } from '@langfuse/otel';

const g = globalThis as typeof globalThis & { __langfuseSpanProcessor?: LangfuseSpanProcessor };

export const langfuseSpanProcessor = (g.__langfuseSpanProcessor ??= new LangfuseSpanProcessor({
  exportMode: 'immediate', // serverless: кожен спан відправляється одразу, а не батчем
}));