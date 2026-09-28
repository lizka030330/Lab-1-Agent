import { HealthResponse } from '../../../src/health';

export function GET(): Response {
  return Response.json(
    HealthResponse.parse({ status: 'ok', timestamp: new Date().toISOString() }),
  );
}
