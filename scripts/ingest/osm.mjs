// Nationwide OpenStreetMap water ingestion for Uzbekistan (Feature 3).
// Usage: node scripts/ingest/osm.mjs
// Writes lib/data-foundation/osm-features.json and lib/data-foundation/regions.json.
// OSM data © OpenStreetMap contributors, ODbL. Centres are element centres, not
// surveyed locations. Region assignment is by bounding-box containment of the
// element centre and is flagged approximate; it is not an official boundary join.
import { writeFileSync } from 'node:fs';
const UA = { 'User-Agent': 'ARIQ-research/3.0 (nationwide water data foundation)', 'Content-Type': 'application/x-www-form-urlencoded' };
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(query, label) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: UA, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(280000) });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        console.log(label, 'elements:', json.elements.length, 'via', url);
        return json.elements;
      } catch (e) { console.warn(label, 'failed via', url, e.message); }
    }
    console.log(label, 'retrying after backoff');
    await new Promise(r => setTimeout(r, 30000));
  }
  throw new Error(`Overpass failed for ${label}`);
}
const round = (v) => Math.round(v * 1e5) / 1e5;
const AREA = 'area["ISO3166-1"="UZ"]->.uz;';

const REGION_IDS = [178016, 178017, 178018, 196240 + 1, 196242, 196246, 196248, 196249, 196251, 196253, 196254, 1670973, 1670974, 2216724]; // verified 2026-10-27: 12 viloyat + Karakalpakstan (196241) + Tashkent city
const regionEls = await overpass(`[out:json][timeout:240];relation(id:${REGION_IDS.join(',')});out center tags;`, 'regions');
const regions = [];
for (const e of regionEls.filter(x => x.tags?.name)) {
  // Relation bounds via Nominatim lookup (same OSM data); `out bb` on these relations overloads Overpass.
  let bbox = null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/lookup?osm_ids=R${e.id}&format=jsonv2`, { headers: UA, signal: AbortSignal.timeout(60000) });
    const arr = await res.json();
    if (arr[0]?.boundingbox) { const b = arr[0].boundingbox.map(Number); bbox = [round(b[2]), round(b[0]), round(b[3]), round(b[1])]; }
  } catch { /* bbox stays null; assignment falls back to null, never guessed */ }
  await new Promise(r => setTimeout(r, 1100)); // Nominatim usage policy: at most 1 req/s
  regions.push({
    id: `osm-${e.type}-${e.id}`, osmType: e.type, osmId: e.id,
    nameEn: e.tags['name:en'] ?? null, nameSource: e.tags.name, nameRu: e.tags['name:ru'] ?? null,
    adminLevel: e.tags.admin_level, centre: e.center ? { latitude: round(e.center.lat), longitude: round(e.center.lon) } : null,
    bbox, bboxSource: bbox ? 'nominatim-lookup-of-osm-relation' : null,
    wikidata: e.tags.wikidata ?? null,
  });
}
regions.sort((a, b) => a.nameSource.localeCompare(b.nameSource));

// Fetch each region's boundary geometry and stitch outer ways into rings.
// Simplified to at most ~300 points per ring; assignment uses point-in-polygon.
function stitchRings(ways) {
  const segs = ways.map(w => w.map(p => [round(p.lon), round(p.lat)]));
  const rings = [];
  while (segs.length) {
    let ring = segs.pop();
    let grew = true;
    while (grew && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], head = ring[0], tail = ring[ring.length - 1];
        const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
        if (eq(s[0], tail)) { ring = ring.concat(s.slice(1)); }
        else if (eq(s[s.length - 1], tail)) { ring = ring.concat([...s].reverse().slice(1)); }
        else if (eq(s[s.length - 1], head)) { ring = s.slice(0, -1).concat(ring); }
        else if (eq(s[0], head)) { ring = [...s].reverse().slice(0, -1).concat(ring); }
        else continue;
        segs.splice(i, 1); grew = true; break;
      }
    }
    if (ring.length > 10) rings.push(ring);
  }
  return rings;
}
for (const region of regions) {
  try {
    const els = await overpass(`[out:json][timeout:280];relation(${region.osmId});out geom;`, `region-geom-${region.osmId}`);
    const members = els[0]?.members ?? [];
    const outer = members.filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry?.length);
    const rings = stitchRings(outer.map(m => m.geometry));
    region.polygon = rings.map(ring => {
      const step = Math.max(1, Math.ceil(ring.length / 300));
      const pts = ring.filter((_, i) => i % step === 0);
      if (pts[pts.length - 1][0] !== ring[ring.length - 1][0] || pts[pts.length - 1][1] !== ring[ring.length - 1][1]) pts.push(ring[ring.length - 1]);
      return pts;
    });
    region.polygonSourcePoints = rings.reduce((n, r) => n + r.length, 0);
    console.log('polygon', region.nameEn, 'rings', region.polygon.length, 'points', region.polygonSourcePoints);
  } catch (e) { region.polygon = null; console.warn('polygon failed', region.nameEn, e.message); }
}
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}
writeFileSync('lib/data-foundation/regions.json', JSON.stringify({ retrievedAt: '2026-10-27', source: 'OpenStreetMap (ODbL), administrative relations in Uzbekistan', regions }, null, 1) + '\n');
console.log('regions written:', regions.length, regions.map(r => r.nameEn ?? r.nameSource).join(' | '));

function assignRegion(lat, lon) {
  // Point-in-polygon against simplified region boundaries. Nested hits
  // (Tashkent city inside Tashkent Region) resolve to the smallest polygon.
  const hits = regions.filter(r => r.polygon?.some(ring => pointInRing(lon, lat, ring)))
    .map(r => ({ name: r.nameEn ?? r.nameSource, area: Math.min(...r.polygon.map(ringArea)) }));
  hits.sort((a, b) => a.area - b.area);
  return hits.length ? hits[0].name : null;
}
const features = [];
function addPoint(e, category, kind) {
  if (!e.center) return;
  const lat = round(e.center.lat), lon = round(e.center.lon);
  features.push({
    id: `osm-${e.type}-${e.id}`, sourceDataset: 'openstreetmap-uzbekistan', category, kind,
    nameEn: e.tags['name:en'] ?? null, nameSource: e.tags.name ?? null,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    region: assignRegion(lat, lon), regionAssignment: 'point-in-polygon-centre',
    basin: null, osm: { type: e.type, id: e.id, url: `https://www.openstreetmap.org/${e.type}/${e.id}` },
    tags: { water: e.tags.water ?? null, waterway: e.tags.waterway ?? null, manMade: e.tags.man_made ?? null },
    connectivity: { status: 'not-verified', note: 'Geographic location only. Proximity to other features is not hydraulic connectivity.' },
  });
}

const bodies = await overpass(`[out:json][timeout:240];${AREA}(way["natural"="water"]["name"](area.uz);relation["natural"="water"]["name"](area.uz););out center tags;`, 'water-bodies');
for (const e of bodies) addPoint(e, 'water-body', e.tags.water === 'reservoir' ? 'reservoir' : e.tags.water === 'lake' ? 'lake' : 'water-body');

const infra = await overpass(`[out:json][timeout:240];${AREA}(node["waterway"="dam"](area.uz);way["waterway"="dam"](area.uz);node["man_made"="pumping_station"](area.uz);way["man_made"="pumping_station"](area.uz);relation["man_made"="pumping_station"](area.uz);node["man_made"="water_works"](area.uz);way["man_made"="water_works"](area.uz););out center tags;`, 'dams-pumps');
for (const e of infra) addPoint(e, 'infrastructure', e.tags.waterway === 'dam' ? 'dam' : e.tags.man_made === 'pumping_station' ? 'pumping-station' : 'water-works');

const ways = await overpass(`[out:json][timeout:280];${AREA}way["waterway"~"^(river|canal|drain|stream)$"]["name"](area.uz);out geom tags;`, 'waterways');
for (const e of ways) {
  if (!e.geometry?.length) continue;
  const pts = e.geometry;
  const step = Math.max(1, Math.ceil(pts.length / 40));
  const coords = [];
  for (let i = 0; i < pts.length; i += step) coords.push([round(pts[i].lon), round(pts[i].lat)]);
  const last = pts[pts.length - 1];
  if (coords[coords.length - 1][0] !== round(last.lon) || coords[coords.length - 1][1] !== round(last.lat)) coords.push([round(last.lon), round(last.lat)]);
  const c = pts[Math.floor(pts.length / 2)];
  features.push({
    id: `osm-way-${e.id}`, sourceDataset: 'openstreetmap-uzbekistan', category: 'waterway', kind: e.tags.waterway,
    nameEn: e.tags['name:en'] ?? null, nameSource: e.tags.name ?? null,
    geometry: { type: 'LineString', coordinates: coords, simplifiedFromPoints: pts.length },
    region: assignRegion(round(c.lat), round(c.lon)), regionAssignment: 'point-in-polygon-midpoint',
    basin: null, osm: { type: 'way', id: e.id, url: `https://www.openstreetmap.org/way/${e.id}` },
    tags: { water: null, waterway: e.tags.waterway, manMade: null },
    connectivity: { status: 'not-verified', note: 'Mapped waterway segment. Shared names or touching geometry were not converted into upstream/downstream claims.' },
  });
}
features.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync('lib/data-foundation/osm-features.json', JSON.stringify({
  retrievedAt: '2026-10-27', source: 'OpenStreetMap contributors (ODbL), via Overpass API', country: 'Uzbekistan',
  note: 'Waterway LineStrings simplified to at most ~40 points (original point count kept in simplifiedFromPoints); coordinates rounded to 5 decimals. Geometry is community mapping, not surveyed cadastre.',
  features,
}, null, 0) + '\n');
console.log('features written:', features.length);
