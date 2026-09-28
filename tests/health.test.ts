import { describe, expect, it } from 'vitest';

import { GET } from '../app/api/health/route';
import { HealthResponse } from '../src/health';

describe('GET /api/health', () => {
  it('повертає 200 і JSON за схемою HealthResponse', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(HealthResponse.safeParse(await response.json()).success).toBe(true);
  });

  it('timestamp — поточний час, а не константа', async () => {
    const before = Date.now();
    const body = HealthResponse.parse(await (await GET()).json());

    expect(Date.parse(body.timestamp)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('схема не пропускає тіло без timestamp', () => {
    expect(HealthResponse.safeParse({ status: 'ok' }).success).toBe(false);
  });
});