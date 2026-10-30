# Nationwide Uzbekistan water-data foundation (Feature 3)

ARIQ covers all of Uzbekistan. This foundation unifies the Feature 2
verified sources with nationwide ingestion, geographic indexing and
evidence management. It does not build a frontend and does not change
the Feature 1 irrigation algorithms, which continue to consume only
explicit scenario inputs — national statistics are never silently
converted into field-level observations.

## What was actually ingested

| Dataset | Records | Coverage / dates | Kind | License |
| --- | --- | --- | --- | --- |
| CAWater-Info reservoir inventory (Feature 2) | 24 reservoirs + 9 rivers | Nationwide, design data as published | reported | Attribution required (no explicit open license) |
| ICWC Water Yearbook 2025 §2 | 7 series | Aral Sea basin / Uzbekistan, year 2025 (storage at 1 Jan 2025) | reported | Attribution required |
| OpenStreetMap, Uzbekistan | 5,945 features + 14 region boundaries | Nationwide: 4,771 named waterway ways (river/canal/drain/stream), 437 named water bodies, dams, pumping stations, water works | reported (community mapping) | ODbL 1.0 |
| SIAT indicator 3.01.02.0002 | 1 series, 13 annual values | National irrigation withdrawal, 2013-2025, million m³/yr | reported | CC BY 4.0 |
| FAO AQUASTAT survey 2012 | 1 aggregate | National dam capacity 22.2 km³ | reported | FAO attribution |
| World Bank API | 24 country-indicator series | Uzbekistan + Kyrgyzstan, Tajikistan, Afghanistan (upstream), Kazakhstan, Turkmenistan; up to 1961-2024 depending on indicator | reported country statistics | CC BY 4.0 |
| Open-Meteo ERA5 archive | 14 series × 120 months | Every first-level region (administrative centre point), Jan 2015 - Dec 2024: monthly precipitation, FAO-56 ET0, mean temperature | modeled reanalysis | CC BY 4.0; ERA5 Copernicus |

Storage layout (no large binaries; total new data ≈ 6 MB of JSON):
[lib/data-foundation/regions.json](/lib/data-foundation/regions.json) (boundaries simplified to ≤300 points/ring),
[lib/data-foundation/osm-features.json](/lib/data-foundation/osm-features.json),
[lib/data-foundation/series.json](/lib/data-foundation/series.json),
[lib/data-foundation/catalog.json](/lib/data-foundation/catalog.json),
[lib/data-foundation/conflicts.json](/lib/data-foundation/conflicts.json),
plus the Feature 2 [lib/water-sources-data.json](/lib/water-sources-data.json).

## Pipelines (repeatable)

```text
node scripts/ingest/osm.mjs     # Overpass: regions, polygons, water bodies, infrastructure, waterways
node scripts/ingest/series.mjs  # World Bank API, Open-Meteo ERA5 archive, ICWC yearbook transcription
node scripts/extract-cawater-reservoirs.mjs <page.html>   # Feature 2 reservoir extraction
```

Each script documents its sources, units, simplification (waterways to
~40 points, coordinates to 5 decimals), and failure behaviour. The
Open-Meteo script retries through the archive API's per-minute limit
rather than dropping regions.

## Geographic indexing and connectivity policy

[lib/data-foundation.ts](/lib/data-foundation.ts) builds a uniform grid
index (0.5° cells) over feature bounding boxes. Tests prove indexed
bounding-box queries equal brute-force scans. Region assignment uses
point-in-polygon against the simplified region boundaries (smallest
polygon wins for Tashkent city inside Tashkent Region); it is a
centre/midpoint assignment for line features and is flagged as such.

**Proximity is not connectivity.** Every feature carries a
`connectivity` status. OSM features are `not-verified`: shared names,
touching geometry, or closeness never become upstream/downstream
claims. The `/api/water-data/nearest` endpoint states this in its
response body. Verified basin labels exist only where a source states
them (CAWater water-source names, ICWC basin statistics).

## Evidence management

[lib/data-foundation/conflicts.json](/lib/data-foundation/conflicts.json)
records reconciliation decisions: cross-source links (23 reservoirs),
aggregate scope differences (CAWater subset 19.598 km³ vs AQUASTAT
22.2 km³ national — coverage, not error), within-source inconsistencies
preserved as published (Tuyamuyun, Zaamin), one rejected source value
(Kattakurgan level, stored null with reason), name aliases
(Zeravshan/Zarafshan), duplicate-name policy, and the
design-vs-measured storage separation. Nothing is silently discarded
or merged.

## APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /api/water-data?q=&kind=&category=&region=&basin=&sourceDataset=&bbox=&limit=&offset=` | Unified feature search; `format=geojson` for MapLibre/Three.js |
| `GET /api/water-data/regions` | All 14 regions with boundary/centre and per-region feature counts |
| `GET /api/water-data/catalog` | Source catalog (status, license, limits) + conflicts register |
| `GET /api/water-data/series?sourceDataset=&country=&region=&measurementKind=&q=` | Time series with kind and provenance |
| `GET /api/water-data/nearest?lat=&lon=&k=` | Nearest point features (proximity only, labelled) |
| `GET /api/water-sources`, `/api/water-sources/[id]` | Feature 2 records (unchanged) |

## What could not be obtained, and why

Recorded in the catalog with status `attempted-not-ingested`:

- **FAO WaPOR**: served through the WaPOR portal/API access workflow; no open bulk download obtained. No ET/biomass values stored.
- **JRC Global Surface Water**: requires a Google Earth Engine account/project; no direct bulk file. No satellite occurrence values stored.
- **Uzhydromet / monitoring.meteo.uz**: portals reachable, but no public machine-readable API or bulk download for hydrological or water-quality observations was found. No station, groundwater, salinity, or water-quality values stored — these likely require Uzhydromet data services.
- **GRDC discharge**: registration and station-owner restrictions. River discharge fields remain null.
- **HydroRIVERS/HydroBASINS geometry**: large shapefile archives and no shapefile toolchain in this repo (no geopandas/pyshp); consulted for modeled-discharge context in Feature 2, geometry not ingested, modeled discharge never estimated.
- **AQUASTAT per-variable data**: the interactive database exposed no bulk API during this build; only the published survey aggregate is stored.

## Known limits

- OSM is community mapping: completeness varies by region, geometry is
  simplified, and pumping-station/dam coverage is what mappers recorded.
- ERA5 monthly series are single-point reanalysis per region, not
  station observations and not field weather for the irrigation engine.
- Yearbook figures are basin aggregates transcribed from text; no
  gauging-station daily flow series are held.
- Groundwater, salinity, soil, and water-quality categories have no
  ingested dataset yet; the catalog records exactly why, and the schema
  (measurement kinds, provenance, conflicts) is ready for them.
