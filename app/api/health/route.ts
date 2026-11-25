import type { HealthResponse } from '../../../src/health';

export const dynamic = 'force-dynamic';

/** «Процес живий» + версія. Модель НЕ викликається — інакше монітор палить квоту. */
export function GET(): Response {
  const body: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_COMMIT_SHA ?? 'unknown',
  };

  return Response.json(body);
}
