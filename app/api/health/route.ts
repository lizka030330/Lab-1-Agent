import { NextRequest, NextResponse } from 'next/server';
import { HealthResponse } from '@/src/health';

export async function GET() {
  const now = new Date();
  const response = {
    status: 'ok',
    timestamp: now.toISOString(),
  };
  
  return NextResponse.json(response, { status: 200 });
}