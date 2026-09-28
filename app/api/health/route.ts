import type { HealthResponse } from '../../../src/health';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const body: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  return Response.json(body);
}
