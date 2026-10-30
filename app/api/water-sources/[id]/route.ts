import {getWaterSource} from '../../../../lib/water-sources.ts';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getWaterSource(id);
  if (!record) return Response.json({ error: `Unknown water source: ${id}` }, { status: 404 });
  return Response.json(record, { headers: { 'Cache-Control': 'no-store' } });
}
