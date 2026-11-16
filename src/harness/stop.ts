/**
 * Шар прогону (Лаб. 3, крок 03): StopCondition поверх isStepCount, що лишає рядок у журналі зупинень.
 * Тип беремо з самого помічника (typeof inner) — власного підпису не вигадуємо.
 * Канонічна назва — isStepCount (stepCountIs — лише аліас у ai@7).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { isStepCount } from 'ai';

export const STOP_LOG = 'docs/lab3/stop-log.jsonl';

/** Один рядок журналу зупинень: який ліміт, на чому, що харнес зробив далі. */
export interface StopEntry {
  readonly taskId: string;
  readonly layer: 'задача' | 'прогін' | 'харнес' | 'CI';
  readonly limit: string;
  readonly value: number | string;
  readonly at_step?: number;
  readonly next?: string;
  readonly [k: string]: unknown;
}

export function logStop(entry: StopEntry, file = STOP_LOG): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

/** Те саме, що isStepCount(n), але при спрацюванні пише рядок у журнал (рівно один раз). */
export function stepLimit(n: number, taskId: string, file = STOP_LOG) {
  const inner = isStepCount(n);
  let logged = false;
  const wrapped: typeof inner = (...args) => {
    const r = inner(...args);
    void Promise.resolve(r).then((hit) => {
      if (!hit || logged) return;
      logged = true;
      logStop({ taskId, layer: 'прогін', limit: 'isStepCount', value: n, at_step: args[0].steps.length }, file);
    });
    return r;
  };
  return wrapped;
}
