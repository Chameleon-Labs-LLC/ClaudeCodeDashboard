import { NextResponse } from 'next/server';
import { PRIMARY_SOURCE_ID, loadSources, saveSources } from '@/lib/usage-sources';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (id === PRIMARY_SOURCE_ID) {
      return NextResponse.json({ error: 'the primary source cannot be modified' }, { status: 400 });
    }
    const body = (await request.json()) as { label?: string; enabled?: boolean };
    const sources = loadSources();
    const source = sources.find((s) => s.id === id);
    if (!source) return NextResponse.json({ error: 'source not found' }, { status: 404 });
    if (typeof body.label === 'string' && body.label.trim()) source.label = body.label.trim();
    if (typeof body.enabled === 'boolean') source.enabled = body.enabled;
    saveSources(sources);
    return NextResponse.json({ source });
  } catch (err) {
    console.error('PATCH /api/sources/[id] failed:', err);
    return NextResponse.json({ error: 'failed to update source' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (id === PRIMARY_SOURCE_ID) {
      return NextResponse.json({ error: 'the primary source cannot be removed' }, { status: 400 });
    }
    const sources = loadSources();
    if (!sources.some((s) => s.id === id)) {
      return NextResponse.json({ error: 'source not found' }, { status: 404 });
    }
    saveSources(sources.filter((s) => s.id !== id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/sources/[id] failed:', err);
    return NextResponse.json({ error: 'failed to remove source' }, { status: 500 });
  }
}
