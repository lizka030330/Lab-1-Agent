/**
 * Телеметрія задеплоєного застосунку (Лаб. 4, крок 06).
 *
 * Провайдер спанів піднімає instrumentation.node.ts (NodeSDK + LangfuseSpanProcessor, exportMode 'immediate').
 * Маршрути — окремі бандли з окремою копією `ai`, тому інтеграцію AI SDK передаємо в КОЖЕН виклик
 * (telemetry.integrations), а не лише через registerTelemetry() у instrumentation.
 * @opentelemetry/api тримає провайдер у глобальному реєстрі, тож tracer тут — той самий, що з NodeSDK.
 *
 * Звʼязок «задача ↔ траса»:
 *   уперед — functionId = task-<id> → атрибут gen_ai.agent.name; плюс lab4.task_id на корінному спані;
 *   назад  — traceId корінного спана повертається у відповіді (trace_id) і пишеться в журнал прогону.
 * recordInputs / recordOutputs — false: вмісту запитів і відповідей у трасі немає (файли користувачів, голос).
 */
import { OpenTelemetry } from '@ai-sdk/otel';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

export const APP_TRACER = 'lab4-app';

const tracer = trace.getTracer(APP_TRACER);

export function newTaskId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Нульовий traceId означає «провайдера немає» (немає ключів Langfuse) → null, а не фальшивий ідентифікатор. */
export function realTraceId(span: Span): string | null {
  const id = span.spanContext().traceId;
  return /[^0]/.test(id) ? id : null;
}

export async function withTaskSpan<T>(workflow: string, taskId: string, fn: (traceId: string | null) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(`invoke_workflow ${workflow}`, async (span) => {
    span.setAttribute('gen_ai.workflow.name', workflow);
    span.setAttribute('lab4.task_id', taskId);
    try {
      return await fn(realTraceId(span));
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.name : 'error' });
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Опції telemetry для generateText / ToolLoopAgent / generateSpeech / transcribe. */
export function aiTelemetry(taskId: string): { isEnabled: true; functionId: string; recordInputs: false; recordOutputs: false; integrations: OpenTelemetry[] } {
  return {
    isEnabled: true,
    functionId: `task-${taskId}`,
    recordInputs: false,
    recordOutputs: false,
    integrations: [new OpenTelemetry()],
  };
}
