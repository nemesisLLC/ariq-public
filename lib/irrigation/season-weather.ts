/**
 * Historical analog weather for season simulations (Feature 5).
 * Uses the Open-Meteo Historical Weather API with the ERA5 model pinned.
 * Returned series are MODELED reanalysis labeled 'historical-analog' —
 * never long-range forecasts and never station observations.
 *
 * Calendar contract (audit M04/M05): provider dates are preserved exactly.
 * A season starting 2020-12-30 runs 2020-12-30, 2020-12-31, 2021-01-01, ...
 * `analogYear` is metadata naming the analog season's start year; it is
 * never rewritten into the day dates. Missing rain or ET0 values reject the
 * series instead of silently becoming zero.
 */
import type { SeasonWeatherDay } from './season.ts';

const DAY_MS = 86400000;
function fmt(d: Date): string { return d.toISOString().slice(0, 10); }

export async function fetchAnalogYear(lat: number, lon: number, plantingDate: string, seasonDays: number, analogYear: number, fetcher: typeof fetch = fetch): Promise<{ year: number; weather: SeasonWeatherDay[]; sourceUrl: string; grid: { latitude: number; longitude: number } }> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Invalid location.');
  if (!Number.isInteger(analogYear) || analogYear < 1940 || analogYear > 2100) throw new Error('Invalid analog year.');
  if (!Number.isInteger(seasonDays) || seasonDays < 1 || seasonDays > 366) throw new Error('Invalid season length.');
  const plantingEpoch = Date.parse(`${plantingDate}T00:00:00.000Z`);
  if (!Number.isFinite(plantingEpoch) || fmt(new Date(plantingEpoch)) !== plantingDate) throw new Error('Invalid planting date.');
  const start = new Date(plantingEpoch);
  start.setUTCFullYear(analogYear);
  const end = new Date(start.getTime() + (seasonDays - 1) * DAY_MS);
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({ latitude: String(lat), longitude: String(lon), start_date: fmt(start), end_date: fmt(end), daily: 'temperature_2m_mean,precipitation_sum,rain_sum,showers_sum,et0_fao_evapotranspiration', timezone: 'Asia/Samarkand', models: 'era5' }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error('Historical weather source unavailable.');
  const data = await response.json();
  const daily = data.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.length !== seasonDays) throw new Error('Incomplete historical weather series.');
  const units = data.daily_units ?? {};
  for (const [field, unit] of [['et0_fao_evapotranspiration', 'mm'], ['rain_sum', 'mm'], ['showers_sum', 'mm']] as const) {
    if (units[field] !== undefined && units[field] !== unit) throw new Error(`Unexpected unit for ${field}: ${units[field]}`);
  }
  const weather: SeasonWeatherDay[] = daily.time.map((date: string, i: number) => {
    const expected = fmt(new Date(start.getTime() + i * DAY_MS));
    if (date !== expected) throw new Error(`Historical weather dates are not the expected consecutive calendar (day ${i}: got ${date}, expected ${expected}).`);
    const et0 = daily.et0_fao_evapotranspiration?.[i];
    const rainPart = daily.rain_sum?.[i];
    const showersPart = daily.showers_sum?.[i];
    if (typeof et0 !== 'number' || !Number.isFinite(et0)) throw new Error('Missing ET0 value in historical weather series.');
    if (typeof rainPart !== 'number' || !Number.isFinite(rainPart) || typeof showersPart !== 'number' || !Number.isFinite(showersPart)) throw new Error('Missing rainfall value in historical weather series; missing rain is never treated as zero.');
    return { date, et0Mm: et0, rainMm: rainPart + showersPart, ...(typeof daily.temperature_2m_mean?.[i] === 'number' ? { tmeanC: daily.temperature_2m_mean[i] } : {}) };
  });
  return { year: analogYear, weather, sourceUrl: url.href, grid: { latitude: data.latitude, longitude: data.longitude } };
}
export async function fetchAnalogYears(lat: number, lon: number, plantingDate: string, seasonDays: number, years: number[], fetcher: typeof fetch = fetch) {
  const out = [];
  for (const year of years) out.push(await fetchAnalogYear(lat, lon, plantingDate, seasonDays, year, fetcher));
  return out;
}
