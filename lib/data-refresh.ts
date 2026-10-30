/**
 * Automatically refreshed real-world intelligence (bounded and honest).
 *
 * A fixed registry of trusted sources — no unrestricted crawling. Every
 * refresh: allowlisted host only, timeout, schema validation, content hash
 * for duplicate detection, full provenance (source URL, license, published/
 * observed/retrieved timestamps where the source provides them). On any
 * failure the last VERIFIED snapshot is kept and marked, never replaced
 * with fabricated freshness.
 *
 * Refresh cadence is per-source: forecast hours, archive monthly,
 * publications yearly/catalogue checks. `Last Updated` shown to users must
 * come from `freshnessReport`, not from page-render time.
 */

export type RefreshSource = {
  id: string;
  name: string;
  url: string;
  host: string;
  license: string;
  measurementKind: 'forecast' | 'modeled' | 'reported' | 'observed';
  refreshHours: number;
  automation: 'json-api' | 'catalog-check' | 'registered-not-automated';
  validate: (data: unknown) => boolean;
  note: string;
  /** The one variable family this source is canonical for (deduplication rule: one canonical source per variable; others are cross-checks only). */
  canonicalFor?: string;
};

const hasDaily = (d: unknown): boolean => {
  const daily = (d as { daily?: { time?: unknown } })?.daily;
  return !!daily && Array.isArray(daily.time) && daily.time.length > 0;
};

export const SOURCE_REGISTRY: RefreshSource[] = [
  {
    id: 'open-meteo-forecast-uz',
    name: 'Open-Meteo Forecast (Uzbekistan reference grid points)',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=41.31&longitude=69.24&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,showers_sum,et0_fao_evapotranspiration&timezone=Asia%2FTashkent&forecast_days=7',
    host: 'api.open-meteo.com', license: 'CC BY 4.0 (Open-Meteo); free service is non-commercial with no uptime SLA',
    measurementKind: 'forecast', refreshHours: 6, automation: 'json-api', validate: hasDaily, canonicalFor: 'Short-term weather forecast and FAO-56 ET0 (farm point queries via the recommendation API)',
    note: 'Model forecast, not station observation. Farm queries use exact farm coordinates through the recommendation API; this snapshot is a national reference point (Tashkent).',
  },
  {
    id: 'open-meteo-archive-era5',
    name: 'Open-Meteo Historical Archive (ERA5)',
    url: 'https://archive-api.open-meteo.com/v1/archive?latitude=41.31&longitude=69.24&start_date=2025-01-01&end_date=2025-01-31&daily=temperature_2m_mean,precipitation_sum,rain_sum,showers_sum,et0_fao_evapotranspiration&timezone=Asia%2FTashkent&models=era5',
    host: 'archive-api.open-meteo.com', license: 'CC BY 4.0 (Open-Meteo); ERA5 via Copernicus C3S',
    measurementKind: 'modeled', refreshHours: 720, automation: 'json-api', validate: hasDaily, canonicalFor: 'Historical analog weather (ERA5 reanalysis) for season scenarios',
    note: 'Modeled reanalysis for historical analog seasons; never presented as a forecast or station record.',
  },
  {
    id: 'cawater-icwc-yearbooks',
    name: 'ICWC / CAWater-Info yearbooks and reservoir inventory',
    url: 'https://cawater-info.net/yearbook/',
    host: 'cawater-info.net', license: 'Publisher terms on site; no explicit open redistribution licence identified — operator must confirm before republication',
    measurementKind: 'reported', refreshHours: 8760, automation: 'catalog-check',
    validate: (d) => typeof d === 'string' && d.length > 100, canonicalFor: 'Reservoir design inventory and ICWC yearbook reporting',
    note: 'Catalogue check only (page reachable/changed). Yearbook figures are ingested deliberately with provenance, not scraped automatically.',
  },
  {
    id: 'siat-uzstat-water',
    name: 'Uzbekistan State Statistics (SIAT) water datasets',
    url: 'https://siat.stat.uz/',
    host: 'siat.stat.uz', license: 'Uzbekistan open-data terms on portal',
    measurementKind: 'reported', refreshHours: 2160, automation: 'registered-not-automated',
    validate: () => false, canonicalFor: 'Official national water-use and agricultural statistics (annual)',
    note: 'Registered for periodic manual review. Dataset IDs change on the portal; automated scraping would be brittle and is intentionally not implemented.',
  },
  {
    id: 'igrac-ggis',
    name: 'IGRAC Global Groundwater Information System',
    url: 'https://ggis.un-igrac.org/',
    host: 'ggis.un-igrac.org', license: 'IGRAC portal terms per dataset',
    measurementKind: 'observed', refreshHours: 2160, automation: 'registered-not-automated',
    validate: () => false, canonicalFor: 'Aquifer boundaries and transboundary aquifer context (e.g. Pretashkent aquifer)',
    note: 'Regional groundwater context only. Never downscaled to a farm water table (see lib/groundwater.ts rules).',
  },
  {
    id: 'uzbekistan-ministry-water',
    name: 'Ministry of Water Resources of the Republic of Uzbekistan',
    url: 'https://water.gov.uz/',
    host: 'water.gov.uz', license: 'Official statements; reuse with attribution, no open API identified',
    measurementKind: 'reported', refreshHours: 720, automation: 'registered-not-automated',
    validate: () => false, canonicalFor: 'Official national water statements, hydropost level announcements, reservoir accumulation policy',
    note: 'Primary official source for Uzbekistan water management statements (e.g. Amu Darya Termez hydropost levels). No public machine-readable API found in research (2026-10); manual review of releases.',
  },
  {
    id: 'uzhydromet',
    name: 'Uzhydromet (Agency of Hydrometeorological Service) and monitoring.meteo.uz',
    url: 'https://gov.uz/en/hydromet',
    host: 'gov.uz', license: 'State hydrometeorological data; terms on portal',
    measurementKind: 'observed', refreshHours: 720, automation: 'registered-not-automated',
    validate: () => false, canonicalFor: 'National hydrometeorological observation network and environmental monitoring (where published)',
    note: 'The authoritative national observer. Published products are largely portal/document based; district groundwater depth/mineralisation and soil-salinity series used in Uzbek research come from these agencies by agreement, not an open API. Do not scrape against portal terms.',
  },
  {
    id: 'sic-icwc-bwo',
    name: 'SIC ICWC / BWO Amu Darya & BWO Syr Darya operational reporting',
    url: 'https://sic.icwc-aral.uz/',
    host: 'sic.icwc-aral.uz', license: 'ICWC publications; cite SIC ICWC and the BWOs',
    measurementKind: 'reported', refreshHours: 720, automation: 'catalog-check',
    validate: (d) => typeof d === 'string' && d.length > 100, canonicalFor: 'Transboundary operational flows, reservoir regimes and seasonal water availability for the Amu Darya and Syr Darya',
    note: 'The operational authority for the two rivers that supply most of Uzbekistan. Seasonal analytical reports compare actual flow/reservoir volumes against ICWC-approved limits. PDF-based: catalogue check only, figures ingested deliberately.',
  },
  {
    id: 'fao-aquastat-uz',
    name: 'FAO AQUASTAT Uzbekistan water-resources account',
    url: 'https://storage.googleapis.com/fao-aquastat.appspot.com/countries_regions/factsheets/water_resources/en/UZB-WRS.pdf',
    host: 'storage.googleapis.com', license: 'FAO AQUASTAT; cite FAO with account year',
    measurementKind: 'reported', refreshHours: 8760, automation: 'catalog-check',
    validate: (d) => typeof d === 'string' && d.length > 100, canonicalFor: 'Long-term national renewable-water accounts (internal/external, surface/groundwater)',
    note: 'Long-term averages, not current conditions: total renewable water resources 48.87 km3/year, of which groundwater produced internally 8 km3/year (FAO AQUASTAT factsheet). Use for national context only.',
  },
  {
    id: 'isric-soilgrids',
    name: 'ISRIC SoilGrids 2.0 (modelled soil properties)',
    url: 'https://soilgrids.org/',
    host: 'soilgrids.org', license: 'CC BY 4.0 (ISRIC)',
    measurementKind: 'modeled', refreshHours: 8760, automation: 'registered-not-automated',
    validate: () => false, canonicalFor: 'Modelled soil texture, SOC, pH, CEC and water-retention covariates at 250 m (context layers)',
    note: 'Machine-learning predictions with uncertainty, not measurements. Access via official downloads/WCS; the paused REST API must not be used. ARIQ algorithms prefer user lab tests, then Saxton-Rawls texture estimates; SoilGrids is a context/cross-check layer.',
  },
  {
    id: 'grdc-discharge',
    name: 'Global Runoff Data Centre (GRDC) station discharge',
    url: 'https://grdc.bafg.de/',
    host: 'grdc.bafg.de', license: 'GRDC data policy; station data on request/registration',
    measurementKind: 'observed', refreshHours: 8760, automation: 'registered-not-automated',
    validate: () => false, canonicalFor: 'Historical gauged river discharge series (station records)',
    note: 'Observed historical discharge where Central Asian stations are available. Registration-gated; ingest deliberately with station metadata.',
  },
  {
    id: 'siat-sdmx-water',
    name: 'SIAT SDMX water-withdrawal datasets 3505-3513 (Ministry of Water Resources via UzStat)',
    url: 'https://api.siat.stat.uz/sdmx/3506/table/download/?download_format=json',
    host: 'api.siat.stat.uz', license: 'Uzbekistan official statistics (SIAT portal terms)',
    measurementKind: 'reported', refreshHours: 720, automation: 'catalog-check',
    validate: (d) => typeof d === 'string' && d.length > 100, canonicalFor: 'Official national irrigation water withdrawal statistics by source (2013-2025)',
    note: 'Machine-readable SDMX JSON discovered and integrated in Phase 1 (lib/data-intelligence/siat-water.json). National totals only; never downscaled to farms. Full re-ingest: scripts/acquire-phase1-data.py.',
  },
  {
    id: 'isric-soilgrids-wcs',
    name: 'ISRIC SoilGrids 2.0 via WCS (maps.isric.org)',
    url: 'https://maps.isric.org/mapserv?map=/map/sand.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCapabilities',
    host: 'maps.isric.org', license: 'CC BY 4.0 (ISRIC SoilGrids)',
    measurementKind: 'modeled', refreshHours: 8760, automation: 'catalog-check',
    validate: (d) => typeof d === 'string' && d.length > 100, canonicalFor: 'Modelled soil texture/SOC/pH/CEC regional statistics with Q0.05-Q0.95 uncertainty',
    note: 'WCS works despite the paused REST API. Phase 1 integrated regional aggregates (lib/data-intelligence/soil-regions.json); re-run scripts/acquire-phase1-data.py to refresh. Modelled, never a farm measurement.',
  },
  {
    id: 'nasa-grace-fo',
    name: 'NASA/GRACE-FO terrestrial water storage (via NASA Earthdata / PO.DAAC)',
    url: 'https://grace.jpl.nasa.gov/',
    host: 'grace.jpl.nasa.gov', license: 'NASA Earthdata terms',
    measurementKind: 'modeled', refreshHours: 2160, automation: 'registered-not-automated',
    validate: () => false, canonicalFor: 'Regional groundwater-storage anomaly context (basin scale)',
    note: 'Satellite gravimetry at hundreds-of-km scale. A regional anomaly signal only; never a farm water-table depth.',
  },
];

export type Snapshot = {
  sourceId: string; retrievedAt: string; contentHash: string; byteLength: number;
  data: unknown; measurementKind: RefreshSource['measurementKind']; sourceUrl: string; license: string;
};
export type RefreshStore = {
  get(id: string): Snapshot | null;
  set(s: Snapshot): void;
};
export function memoryStore(): RefreshStore & { map: Map<string, Snapshot> } {
  const map = new Map<string, Snapshot>();
  return { map, get: (id) => map.get(id) ?? null, set: (s) => { map.set(s.sourceId, s); } };
}

/** Deterministic content hash (cyrb53) for duplicate/change detection. Not a security hash. */
export function contentHash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

export type RefreshOutcome =
  | { status: 'updated' | 'unchanged'; sourceId: string; snapshot: Snapshot }
  | { status: 'kept-last-verified' | 'unavailable'; sourceId: string; snapshot: Snapshot | null; error: string };

const ALLOWED_HOSTS = new Set(SOURCE_REGISTRY.map((s) => s.host));

export async function refreshSource(source: RefreshSource, options: { fetcher?: typeof fetch; store: RefreshStore; nowMs?: number; timeoutMs?: number } = { store: memoryStore() }): Promise<RefreshOutcome> {
  const store = options.store;
  const fetcher = options.fetcher ?? fetch;
  const now = options.nowMs ?? Date.now();
  const previous = store.get(source.id);
  try {
    // SSRF guard: the fetch target is the registry URL itself; its host must be allowlisted.
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.host)) throw new Error(`Source host ${url.host} is not on the allowlist`);
    if (source.automation === 'registered-not-automated') {
      return { status: previous ? 'kept-last-verified' : 'unavailable', sourceId: source.id, snapshot: previous, error: 'Registered for manual review; no automated fetch is performed for this source.' };
    }
    const response = await fetcher(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 15000), headers: { 'User-Agent': 'ARIQ-data-refresh/1.0 (+https://github.com/nemesisLLC/ariq)' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = source.automation === 'json-api' ? await response.json() : await response.text();
    if (!source.validate(raw)) throw new Error('Response failed schema validation');
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const hash = contentHash(text);
    if (previous && previous.contentHash === hash) return { status: 'unchanged', sourceId: source.id, snapshot: previous };
    const snapshot: Snapshot = {
      sourceId: source.id, retrievedAt: new Date(now).toISOString(), contentHash: hash, byteLength: text.length,
      data: source.automation === 'json-api' ? raw : { reachable: true, bytes: text.length },
      measurementKind: source.measurementKind, sourceUrl: source.url, license: source.license,
    };
    store.set(snapshot);
    return { status: 'updated', sourceId: source.id, snapshot };
  } catch (error) {
    return { status: previous ? 'kept-last-verified' : 'unavailable', sourceId: source.id, snapshot: previous, error: error instanceof Error ? error.message : 'fetch failed' };
  }
}

export async function refreshAll(options: { fetcher?: typeof fetch; store: RefreshStore; nowMs?: number }): Promise<RefreshOutcome[]> {
  const out: RefreshOutcome[] = [];
  for (const source of SOURCE_REGISTRY) out.push(await refreshSource(source, options));
  return out;
}

/** Accurate freshness view for the frontend "Last Updated" display. */
export function freshnessReport(store: RefreshStore, nowMs: number): {
  sourceId: string; name: string; state: 'live' | 'stale' | 'never-updated' | 'manual-review';
  lastUpdated: string | null; ageHours: number | null; refreshHours: number; measurementKind: string; sourceUrl: string; license: string; note: string; canonicalFor: string | null;
}[] {
  return SOURCE_REGISTRY.map((s) => {
    const snap = store.get(s.id);
    const base = { sourceId: s.id, name: s.name, refreshHours: s.refreshHours, measurementKind: s.measurementKind, sourceUrl: s.url, license: s.license, note: s.note, canonicalFor: s.canonicalFor ?? null };
    if (s.automation === 'registered-not-automated') return { ...base, state: 'manual-review' as const, lastUpdated: snap?.retrievedAt ?? null, ageHours: null };
    if (!snap) return { ...base, state: 'never-updated' as const, lastUpdated: null, ageHours: null };
    const ageHours = (nowMs - Date.parse(snap.retrievedAt)) / 3600000;
    return { ...base, state: ageHours <= s.refreshHours ? 'live' as const : 'stale' as const, lastUpdated: snap.retrievedAt, ageHours };
  });
}
