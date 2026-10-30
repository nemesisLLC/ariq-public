import {regionSummary} from '../../../../lib/data-foundation.ts';
export function GET() {
  return Response.json({ count: 14, regions: regionSummary() }, { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } });
}
