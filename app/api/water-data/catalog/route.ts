import {foundationCatalog, foundationConflicts} from '../../../../lib/data-foundation.ts';
export function GET() {
  return Response.json({ catalog: foundationCatalog, conflicts: foundationConflicts }, { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } });
}
