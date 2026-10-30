// Ingests public time-series for the nationwide foundation (Feature 3):
//  - World Bank API: water/agriculture indicators for Uzbekistan and the upstream
//    transboundary countries (Kyrgyzstan, Tajikistan, Afghanistan, Kazakhstan, Turkmenistan).
//    World Bank values are reported/modelled country statistics, never field observations.
//  - Open-Meteo Archive (ERA5 reanalysis): monthly precipitation, temperature and
//    FAO-56 reference evapotranspiration aggregated from daily values at each
//    region's administrative centre, 2015-2024. Reanalysis is MODELED data.
//  - ICWC yearbook 2025 (CAWater-Info), section 2.1: reported basin statistics,
//    transcribed from the published text with section references kept per value.
// Writes lib/data-foundation/series.json.
import { readFileSync, writeFileSync } from 'node:fs';
const RETRIEVED = '2026-10-27';
const series = [];

const INDICATORS = {
  'ER.H2O.INTR.PC': 'Renewable internal freshwater resources per capita (m3)',
  'ER.H2O.INTR': 'Renewable internal freshwater resources, total (billion m3)',
  'ER.H2O.FWAG.ZS': 'Annual freshwater withdrawals, agriculture (% of total freshwater withdrawal)',
  'ER.H2O.FWTT.ZS': 'Annual freshwater withdrawals, total (% of internal resources)',
  'AG.LND.IRIG.AG.ZS': 'Agricultural irrigated land (% of total agricultural land)',
  'AG.LND.AGRI.ZS': 'Agricultural land (% of land area)',
};
const COUNTRIES = { UZB: 'Uzbekistan', KGZ: 'Kyrgyzstan (upstream)', TJK: 'Tajikistan (upstream)', AFG: 'Afghanistan (upstream)', KAZ: 'Kazakhstan (downstream/basin)', TKM: 'Turkmenistan (basin)' };
for (const [code, country] of Object.entries(COUNTRIES)) {
  for (const [indicator, label] of Object.entries(INDICATORS)) {
    const url = `https://api.worldbank.org/v2/country/${code}/indicator/${indicator}?format=json&per_page=100`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      const json = await res.json();
      const values = (json[1] ?? []).filter(v => v.value !== null).map(v => ({ year: Number(v.date), value: v.value })).sort((a, b) => a.year - b.year);
      if (!values.length) { console.log('empty', code, indicator); continue; }
      series.push({
        id: `worldbank-${code.toLowerCase()}-${indicator.toLowerCase().replace(/\./g, '-')}`,
        sourceDataset: 'world-bank-api', country, geography: code === 'UZB' ? 'national' : 'transboundary-context',
        indicator: label, indicatorCode: indicator, unit: label.match(/\(([^)]+)\)/)?.[1] ?? 'percent',
        measurementKind: 'reported-country-statistic', values,
        provenance: { publisher: 'World Bank (World Development Indicators via api.worldbank.org)', url, retrievedAt: RETRIEVED, publicationDate: null, license: 'CC BY 4.0 (World Bank Open Data)', role: 'Country-level reported/modeled statistic. Not a field, canal, or farm observation; must not be downscaled to fields.' },
      });
      console.log('wb', code, indicator, values.length, values[0].year, '-', values.at(-1).year);
    } catch (e) { console.warn('wb failed', code, indicator, e.message); }
  }
}

const regions = JSON.parse(readFileSync('lib/data-foundation/regions.json', 'utf8').replace(/^\uFEFF/, '')).regions;
for (const region of regions) {
  if (!region.centre) continue;
  const name = region.nameEn ?? region.nameSource;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${region.centre.latitude}&longitude=${region.centre.longitude}&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_mean,precipitation_sum,et0_fao_evapotranspiration&timezone=Asia%2FSamarkand`;
  try {
    let json;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      json = await res.json();
      if (json.daily?.time) break;
      console.log('era5 retry', name, json.reason ?? res.status);
      await new Promise(r => setTimeout(r, 20000));
    }
    if (!json.daily?.time) throw new Error('archive API returned no daily data after retries');
    await new Promise(r => setTimeout(r, 1500));
    const months = new Map();
    json.daily.time.forEach((date, i) => {
      const key = date.slice(0, 7);
      const m = months.get(key) ?? { precipMm: 0, et0Mm: 0, tempSum: 0, days: 0 };
      m.precipMm += json.daily.precipitation_sum[i] ?? 0;
      m.et0Mm += json.daily.et0_fao_evapotranspiration[i] ?? 0;
      if (json.daily.temperature_2m_mean[i] !== null) { m.tempSum += json.daily.temperature_2m_mean[i]; m.days++; }
      months.set(key, m);
    });
    const monthly = [...months.entries()].sort().map(([month, m]) => ({ month, precipitationMm: Math.round(m.precipMm * 10) / 10, et0Mm: Math.round(m.et0Mm * 10) / 10, temperatureMeanC: m.days ? Math.round((m.tempSum / m.days) * 100) / 100 : null }));
    series.push({
      id: `era5-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`, sourceDataset: 'open-meteo-era5-archive',
      country: 'Uzbekistan', geography: 'region-admin-centre-point', region: name,
      point: region.centre, indicator: 'Monthly precipitation sum, FAO-56 ET0 sum, mean temperature (ERA5 reanalysis, daily values aggregated by ARIQ script)', unit: 'mm/month and degC',
      measurementKind: 'modeled-reanalysis', values: monthly,
      provenance: { publisher: 'Open-Meteo Archive API (ERA5 reanalysis)', url, retrievedAt: RETRIEVED, publicationDate: null, license: 'CC BY 4.0 (Open-Meteo); ERA5: Copernicus Climate Change Service', role: 'Modeled reanalysis at the region administrative centre point (grid cell reported by the API in the raw response). Not a rain-gauge or station observation, and not field-level weather.' },
    });
    console.log('era5', name, monthly.length, 'months');
  } catch (e) { console.warn('era5 failed', name, e.message); }
}

// ICWC yearbook 2025, Section 2.1 — values transcribed verbatim from the published
// English text (thousands separator in the source is a comma: 108,31 = 108.31 km3).
const YB = 'https://cawater-info.net/yearbook/2025/02_yearbook2025_en.htm';
const yb = (id, indicator, unit, values, section) => series.push({
  id: `icwc-yearbook-2025-${id}`, sourceDataset: 'icwc-cawater-yearbook', country: 'Aral Sea basin / Uzbekistan',
  geography: 'basin-or-country-as-stated', indicator, unit, measurementKind: 'reported-basin-statistic', values,
  provenance: { publisher: 'ICWC / CAWater-Info, Water Yearbook 2025, Section 2', url: YB, retrievedAt: RETRIEVED, publicationDate: '2025', license: 'CAWater-Info knowledge base (attribution required)', role: `Transcribed from ${section}. Reported basin statistics compiled by ICWC from basin water organisations; not ARIQ measurements.` },
});
yb('amu-syr-runoff', 'Total annual natural (unregulated) runoff, Amu Darya (large basin) and Syr Darya basins', 'km3/year', [{ year: 2025, value: 108.31 }], '§2.1.1');
yb('amu-runoff', 'Total annual unregulated runoff, larger Amu Darya basin', 'km3/year', [{ year: 2025, value: 75.06 }], '§2.1.1');
yb('amu-kerki-flow', 'Natural (unregulated) Amu Darya flow at Nominal Kerki gauging section', 'km3/year', [{ year: 2025, value: 64.42 }], '§2.1.1');
yb('syr-runoff', 'Total annual unregulated runoff, Syr Darya basin', 'km3/year', [{ year: 2025, value: 33.25 }], '§2.1.1');
yb('tuyamuyun-inflow-release', 'Tuyamuyun hydrosystem annual inflow / releases', 'km3/year', [{ year: 2025, value: 20.39, component: 'inflow' }, { year: 2025, value: 21.61, component: 'releases' }], '§2.1.2');
yb('uzbekistan-amu-withdrawal', 'Uzbekistan water withdrawal, smaller Amu Darya basin: established limit / actual', 'km3/year', [{ year: 2025, value: 23.69, component: 'limit' }, { year: 2025, value: 19.78, component: 'actual' }], '§2.1.3');
yb('syr-reservoir-storage-jan2025', 'Total storage, Syr Darya basin reservoirs (Toktogul, Andijan, Bahri Tojik, Charvak, Shardara), as of 1 Jan 2025', 'km3', [{ year: 2025, value: 21.35 }], '§2.1.1');

writeFileSync('lib/data-foundation/series.json', JSON.stringify({ retrievedAt: RETRIEVED, series }, null, 1) + '\n');
console.log('series written:', series.length);
