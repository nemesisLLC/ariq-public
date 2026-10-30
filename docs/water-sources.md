# Uzbekistan water-source database (Feature 2)

Machine-readable dataset: [lib/water-sources-data.json](/lib/water-sources-data.json),
query library: [lib/water-sources.ts](/lib/water-sources.ts).
API: `GET /api/water-sources` (search `q`, `kind`, `region`, `basin`,
`bbox=minLon,minLat,maxLon,maxLat`, `hasCoordinates`, `limit`, `offset`,
`format=geojson`, `include=statistics`) and
`GET /api/water-sources/[id]`. GeoJSON output is Point features in
`[longitude, latitude]` order for MapLibre/Three.js; records without
verified coordinates are listed under `excludedWithoutCoordinates` and
are never placed at a guessed position.

## Contents at a glance

| Collection | Count | Source |
| --- | --- | --- |
| Reservoirs | 24 (23 with verified centre coordinates, 1 null) | CAWater-Info reservoir inventory + OpenStreetMap name matches |
| Rivers | 9 | Rivers named as water sources in the CAWater inventory; Zarafshan geometry held in-repo |
| National statistics | 2 series | SIAT (Uzbekistan Statistics Agency) and FAO AQUASTAT |

Samarkand/Zarafshan coverage: Akdarya and Kattakurgan reservoirs
(Samarkand region), Kuyumazar and Shurkul on the Zarafshan, and the
Zarafshan River record referencing the OSM geometry already held at
[public/data/samarkand-waterways.json](/public/data/samarkand-waterways.json).

## Sources actually used

| Source | URL | Used for | Not used for |
| --- | --- | --- | --- |
| CAWater-Info, "Reservoirs in Uzbekistan" | https://cawater-info.net/bk/1-1-1-1-3-uz_e.htm | Names, regions, water sources, type, purpose, commissioning year, design capacities, surface, dam/hydropower design data (retrieved 2026-10-26) | Coordinates (the page publishes none); measured storage (it publishes design values) |
| OpenStreetMap (ODbL) | https://www.openstreetmap.org | Centre coordinates of 23 reservoirs from individually name-verified elements (element id and URL stored per record) | Any record whose match was ambiguous |
| HydroSHEDS / HydroRIVERS | https://www.hydrosheds.org/products/hydrorivers | Consulted: modeled river network/discharge model (15 arc-second reaches, modeled long-term average discharge) | No discharge value is stored: HydroRIVERS reaches carry no river names, so a verified named-river join was not possible in this build `modeledMeanM3S` is null, marked `not-extracted` |
| SIAT indicator 3.01.02.0002 | https://siat.stat.uz/data/3506/?lang=en | National irrigation water withdrawal 2013-2025, million m³/yr, CC BY 4.0, updated 2026-04-28 | Regional values (the published table is national only, so none are stored) |
| FAO AQUASTAT (survey reported in *Irrigation in Central Asia in Figures*, 2012) | https://www.fao.org/4/i3289e/i3289e.pdf | National total dam capacity aggregate: 22.2 km³ (2012) | Per-reservoir values; measured storage |

## Semantics enforced by tests

- `storage.kind` is always `design-capacity`; `measuredStorageMillionM3`
  is always null. Design capacity is never presented as actual storage.
- River `discharge.observedMeanM3S` and `modeledMeanM3S` are null; modeled
  and observed flow are distinct fields and neither is estimated.
- Unknown values are null, never invented. Two worked examples:
  Aktepa Reservoir coordinates are null because two nearby OSM "Oqtepa"
  water bodies make the match ambiguous; Kattakurgan's normal level is
  null because CAWater's 31.5 m is inconsistent with its own dam data
  (the rejected value and reason are kept in `quality.notes`).
- Published inconsistencies are preserved and flagged, not silently
  "fixed": where CAWater active + dead storage differs from its total
  (e.g. Tuyamuyun, Zaamin), values stay as published and
  `quality.notes` says so. Tests fail if such a discrepancy is unflagged.
- Every record carries provenance (source id, URL, retrieval date,
  publication date or null) and data-quality metadata.
- Basin assignments are derived from each reservoir's named water source
  and are labelled as such; no HydroBASINS code is claimed
  (`basin` is a name, and river records note the derivation).

## Rebuilding the dataset

Reservoir fields were extracted from the downloaded CAWater page with
[scripts/extract-cawater-reservoirs.mjs](/scripts/extract-cawater-reservoirs.mjs),
then joined to OpenStreetMap elements queried for named water bodies in
Uzbekistan (`area["ISO3166-1"="UZ"]`, `natural=water`), with each match
inspected by name before its centre coordinates were accepted. SIAT
values come from the JSON download linked from the indicator page
(`api.siat.stat.uz/sdmx/3506/...`). Retrieved 2026-10-26.

## Known gaps

- CAWater lists 24 reservoirs; AQUASTAT reports at least 50 in
  Uzbekistan. Records not in CAWater are absent, not estimated.
- No measured storage, observed discharge, or canal geometries are
  included; the irrigation engine's canal networks remain scenario
  inputs, as before.
