import { z } from 'zod';

/** Контракт відповіді GET /api/health. Пишеться ДО того, як задачу отримує агент. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;