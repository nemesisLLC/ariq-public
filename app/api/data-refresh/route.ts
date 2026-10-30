import { SOURCE_REGISTRY, freshnessReport, memoryStore, type RefreshStore } from '../../../lib/data-refresh.ts';

// Process-local snapshot store. On Cloudflare this maps to the scheduled
// Worker's cache/KV snapshot (see docs/CLOUDFLARE_ARCHITECTURE.md); in Node
// it simply reports registry state until a refresh populates it.
const globalState = globalThis as typeof globalThis & { __ariqRefreshStore?: RefreshStore };
const store = globalState.__ariqRefreshStore ??= memoryStore();

export function GET() {
  return Response.json(
    { kind: 'data-freshness', generatedAt: new Date().toISOString(), sources: freshnessReport(store, Date.now()), registrySize: SOURCE_REGISTRY.length },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
