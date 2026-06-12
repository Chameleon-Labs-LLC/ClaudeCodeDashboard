import { NextResponse } from 'next/server';
import { buildUsageReport, loadAllUsageEntries, type Granularity } from '@/lib/usage-engine';
import { getPricingMap } from '@/lib/litellm-pricing';

export const dynamic = 'force-dynamic';

const GRANULARITIES = new Set(['day', 'week', 'month']);

function listParam(searchParams: URLSearchParams, name: string): string[] | undefined {
  const raw = searchParams.get(name);
  if (!raw) return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const g = searchParams.get('granularity') ?? 'day';
    const report = buildUsageReport(loadAllUsageEntries(), await getPricingMap(), {
      since: searchParams.get('since') ?? undefined,
      until: searchParams.get('until') ?? undefined,
      granularity: (GRANULARITIES.has(g) ? g : 'day') as Granularity,
      projects: listParam(searchParams, 'projects'),
      models: listParam(searchParams, 'models'),
      sources: listParam(searchParams, 'sources'),
    });
    return NextResponse.json(report);
  } catch (err) {
    console.error('GET /api/usage failed:', err);
    return NextResponse.json({ error: 'failed to build usage report' }, { status: 500 });
  }
}
