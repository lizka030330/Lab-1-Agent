import { z } from 'zod';

/** Контракт відповіді GET /api/health. Пишеться ДО того, як задачу отримує агент. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
  /** Версія застосунку (Лаб. 4, крок 06): SHA комміту деплою; локально — 'unknown'. */
  commit: z.string().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;