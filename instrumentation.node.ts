import { NodeSDK } from '@opentelemetry/sdk-node';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { langfuseSpanProcessor } from './src/otel/langfuse';

// Провайдер спанів для всього процесу; експорт — LangfuseSpanProcessor (OTLP/HTTP до Langfuse, exportMode 'immediate').
new NodeSDK({ spanProcessors: [langfuseSpanProcessor] }).start();
// Глобальна інтеграція AI SDK (конвенції GenAI). Маршрути додатково передають її в кожен виклик — див. src/telemetry.ts.
registerTelemetry(new OpenTelemetry());
