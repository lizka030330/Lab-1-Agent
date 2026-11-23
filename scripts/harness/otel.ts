/**
 * Трасування прогонів (Лаб. 3, крок 06). Імпортується в run-queue.ts до першого прогону.
 * Експорт — OTLP/HTTP (не gRPC: Langfuse його не приймає). Ендпоінт і заголовки — з OTEL_EXPORTER_OTLP_*
 * у середовищі, а не в коді: ключ Langfuse у репозиторій не кладеться.
 * Без OTEL_EXPORTER_OTLP_ENDPOINT SDK не стартує: спани не створюються, trace_id у run.json буде null.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
  sdk.start();
  // SDK має дослати спани до виходу; shutdown чекає на експорт
  process.once('beforeExit', () => { void sdk.shutdown(); });
}
