// Extracts the CAWater-Info "Reservoirs in Uzbekistan" inventory to JSON.
// Usage: node scripts/extract-cawater-reservoirs.mjs <downloaded-page.html> [out.json]
// Source: https://cawater-info.net/bk/1-1-1-1-3-uz_e.htm (see docs/water-sources.md).
// Numbers use either "." decimal, "," decimal (138,5), or "," thousands (3,100);
// a comma followed by exactly three digits is thousands, otherwise decimal.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '');
const out = process.argv[3] ?? 'cawater-reservoirs.json';
let text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\r/g, '');
text = text.slice(text.indexOf('Aktepa reservoir'));
const names = [...html.matchAll(/<strong>([^<]*(?:reservoir|hydroscheme)[^<]*)<\/strong>/gi)].map(m => m[1].trim());
const field = (block, label) => {
  const m = block.match(new RegExp(label + '\\s*:?\\s*([^\\n]+)', 'i'));
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
};
const num = (v) => {
  if (v === null) return null;
  const s = v.replace(/\s/g, '');
  return Number(/,\d{3}(\D|$)/.test(s) || /,\d{3},/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'));
};
const records = names.map((name, i) => {
  const from = text.indexOf(name);
  const block = text.slice(from, i + 1 < names.length ? text.indexOf(names[i + 1]) : text.length);
  return {
    sourceName: name,
    location: field(block, 'Location'),
    waterSource: field(block, 'Water source'),
    reservoirType: field(block, 'Reservoir type'),
    purpose: field(block, 'Purpose of operation'),
    yearCommissioned: num(field(block, 'Year of putting into operation')),
    normalLevelM: num(field(block, 'Normal maximum operating level \\(m\\)')),
    totalCapacityMlnM3: num(field(block, 'Total capacity \\(mln\\.? ?m3\\)')),
    activeCapacityMlnM3: num(field(block, 'Active capacity \\(mln\\.? ?m3\\)')),
    deadStorageMlnM3: num(field(block, 'Dead storage capacity \\(mln\\.? ?m3\\)')),
    surfaceKm2: num(field(block, 'Water surface \\(km2\\)')),
    lengthKm: num(field(block, 'Length \\(km\\)')),
    damType: field(block, 'Dam type'),
    damHeightM: num(field(block, 'Height \\(m\\)')),
    damLengthM: num(field(block, 'Length \\(m\\)')),
    hydropowerCapacityMW: num(field(block, 'Design capacity \\(MW\\)')),
  };
});
writeFileSync(out, JSON.stringify(records, null, 1) + '\n');
console.log(`wrote ${records.length} reservoir records to ${out}`);
