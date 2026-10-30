/**
 * ARIQ advanced irrigation scheduler (version ariq-irrigation-v2).
 *
 * Scientific basis (see docs/irrigation-scheduling.md):
 * - FAO Irrigation and Drainage Paper 56 (Allen et al., 1998): FAO
 *   Penman-Monteith ET0 (Eq. 6), ETc = Kc * ET0 (Eq. 58), ETc adj = Ks * Kc
 *   * ET0 for the single-coefficient approach (Eq. 81), TAW (Eq. 82),
 *   RAW = p * TAW (Eq. 83), Ks (Eq. 84), daily root-zone balance (Eq. 85),
 *   and the Kc curve construction of Chapter 6.
 * - FAO CROPWAT 8.0 methodology: irrigation schedules are developed from a
 *   daily soil-water balance under user-defined supply and management
 *   conditions. This module follows that structure; it is not CROPWAT and
 *   does not reproduce CROPWAT outputs.
 *
 * Everything here is deterministic: no randomness, no AI-generated numbers.
 * Inputs are simulations by construction (`kind: 'simulation'`); measured
 * data can only enter as explicit caller-supplied values.
 */
import { InputError } from './core.ts';
import type { Soil } from './core.ts';

export type MetInput = {
  tmaxC: number; tminC: number; windMPerS: number; solarRadiationMJm2Day: number;
  dewpointC?: number; rhMaxPct?: number; rhMinPct?: number;
};
export type AdvancedWeatherDay = { date: string; rainMm: number; et0Mm?: number; met?: MetInput };
export type KcCurve = { kcIni: number; kcMid: number; kcEnd: number; stageLengthsDays: { initial: number; development: number; mid: number; late: number } };
export type AdvancedFieldInput = {
  id: string; nodeId: string; areaHa: number; applicationEfficiency: number; priority: number; soil: Soil;
  kc?: number; kcCurve?: KcCurve;
  /** Days from the start of the Kc curve's initial stage to the first weather date (e.g. planting date before the forecast horizon). Defaults to 0. */
  kcStartDayIndex?: number;
};
export type AdvancedCanalInput = {
  id: string; from: string; to: string; maxFlowM3PerHour: number; efficiency: number; closed: boolean;
  volumeLimitM3?: number; closedDates?: string[];
};
export type ScheduleInput = {
  kind: 'simulation'; inputNote: string; rainRetentionFraction: number;
  station?: { latitudeDeg: number; elevationM: number };
  weather: AdvancedWeatherDay[]; fields: AdvancedFieldInput[];
  network: {
    sourceId: string; nodes: string[]; supplyM3: number; supplyPerDayM3?: number;
    sourceMaxFlowM3PerHour: number; windowHoursPerDay: number; edges: AdvancedCanalInput[];
  };
};
export type DailyState = {
  date: string; et0Mm: number; kc: number; ks: number; etCropMm: number; effectiveRainMm: number;
  irrigationRootZoneMm: number; drainageMm: number; startDepletionMm: number; endDepletionMm: number; stress: boolean;
  /** True when actual ET was limited by physically available root-zone water (audit M01). */
  etLimitedByAvailableWater: boolean;
};
export type IrrigationEvent = {
  eventId: string; fieldId: string; deadlineDate: string; netIrrigationMm: number; grossDemandM3: number;
  allocatedM3: number; unmetM3: number; status: 'scheduled' | 'partially-scheduled' | 'impossible-before-deadline';
  bindingConstraints: string[];
  /** Always false: the greedy allocator is not a proof of infeasibility (audit M03). 'impossible-before-deadline' means "not scheduled by this heuristic". */
  feasibilityProven: false;
};
export type Delivery = {
  fieldId: string; eventId: string; date: string; startHour: number; endHour: number; durationHours: number;
  gateFlowM3PerHour: number; sourceFlowM3PerHour: number; gateVolumeM3: number; sourceVolumeM3: number;
};
export type FieldSchedule = {
  fieldId: string; totalAvailableMm: number; readilyAvailableMm: number;
  firstStressDateWithoutIrrigation: string | null; stressDaysWithoutIrrigation: number;
  allocatedGateM3: number; unmetGateM3: number; stressDaysScheduled: number; minimumKsScheduled: number;
  cumulativeStressIndex: number; dailyNoIrrigation: DailyState[]; dailyScheduled: DailyState[];
};
export type ScheduleResult = {
  version: 'ariq-irrigation-v2'; kind: 'simulation'; inputNote: string; method: string; objective: string;
  assumptions: string[]; fields: FieldSchedule[]; events: IrrigationEvent[]; deliveries: Delivery[];
  totals: {
    grossDemandM3: number; allocatedGateM3: number; unmetGateM3: number; weightedUnmetPriorityM3: number;
    sourceUsedM3: number; unusedSupplyM3: number; conveyanceLossM3: number; applicationLossM3: number;
    rootZoneDeliveredM3: number; rootZoneRetainedM3: number; drainageMmTotal: number;
    stressDaysScheduled: number; stressDaysWithoutIrrigation: number; eventsScheduled: number; eventsImpossible: number;
  };
  warnings: string[];
};

// ---------------------------------------------------------------- validation
type Obj = Record<string, unknown>;
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
function fail(message: string): never { throw new InputError(message); }
function object(value: unknown, label: string): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Obj;
}
function num(value: unknown, low: number, high: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${label} must be a finite number in [${low}, ${high}]`);
  return value;
}
function flow(value: unknown, label: string): number {
  const r = num(value, 0, 1e7, label);
  if (r > 0 && r < 1e-6) fail(`${label} must be zero or at least 0.000001 m3/hour`);
  return r;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(`${label} must match ${idPattern.source}`);
  return value;
}
function array(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must be an array with ${min}..${max} entries`);
  return value;
}
function dateEpoch(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') fail(`${label} must be a valid YYYY-MM-DD calendar date (year 0001..9999)`);
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) fail(`${label} is not a valid calendar date`);
  return epoch;
}

// ------------------------------------------------------- FAO-56 Penman-Monteith
export type PenmanMonteithInput = MetInput & { date: string; latitudeDeg: number; elevationM: number };
export type PenmanMonteithResult = {
  et0MmPerDay: number; meanSaturationVapourPressureKpa: number; actualVapourPressureKpa: number;
  slopeVapourPressureKpaPerC: number; atmosphericPressureKpa: number; psychrometricConstantKpaPerC: number;
  netRadiationMJm2Day: number; extraterrestrialRadiationMJm2Day: number;
};
const saturationVapourPressure = (tC: number): number => 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3)); // FAO-56 Eq. 11

export function penmanMonteithDetails(input: PenmanMonteithInput): PenmanMonteithResult {
  const m = object(input, 'met');
  const tmax = num(m.tmaxC, -60, 60, 'met.tmaxC'), tmin = num(m.tminC, -60, 60, 'met.tminC');
  if (tmin > tmax) fail('met.tminC must not exceed met.tmaxC');
  const wind = num(m.windMPerS, 0, 50, 'met.windMPerS');
  const rs = num(m.solarRadiationMJm2Day, 0, 50, 'met.solarRadiationMJm2Day');
  const latitudeDeg = num(m.latitudeDeg, -66.5, 66.5, 'latitudeDeg');
  const elevationM = num(m.elevationM, -500, 9000, 'elevationM');
  dateEpoch(m.date, 'met.date');
  const eTmax = saturationVapourPressure(tmax), eTmin = saturationVapourPressure(tmin);
  const es = (eTmax + eTmin) / 2; // Eq. 12
  let ea: number;
  if (m.dewpointC !== undefined) ea = saturationVapourPressure(num(m.dewpointC, -60, 60, 'met.dewpointC'));
  else if (m.rhMaxPct !== undefined && m.rhMinPct !== undefined) {
    ea = (eTmin * num(m.rhMaxPct, 0, 100, 'met.rhMaxPct') / 100 + eTmax * num(m.rhMinPct, 0, 100, 'met.rhMinPct') / 100) / 2; // Eq. 17
  } else fail('met requires dewpointC or both rhMaxPct and rhMinPct');
  const tmean = (tmax + tmin) / 2;
  const slope = (4098 * saturationVapourPressure(tmean)) / Math.pow(tmean + 237.3, 2); // Eq. 13
  const pressure = 101.3 * Math.pow((293 - 0.0065 * elevationM) / 293, 5.26); // Eq. 7
  const gamma = 0.000665 * pressure; // Eq. 8
  const doy = Math.round((Date.parse(`${m.date as string}T00:00:00.000Z`) - Date.parse(`${(m.date as string).slice(0, 4)}-01-01T00:00:00.000Z`)) / 86400000) + 1;
  const phi = (Math.PI / 180) * latitudeDeg;
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * doy); // Eq. 23
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * doy - 1.39); // Eq. 24
  const ws = Math.acos(Math.min(1, Math.max(-1, -Math.tan(phi) * Math.tan(delta)))); // Eq. 25
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws)); // Eq. 21
  const rso = (0.75 + 2e-5 * elevationM) * ra; // Eq. 37
  const rns = (1 - 0.23) * rs; // Eq. 38 (albedo 0.23)
  const tmaxK = tmax + 273.16, tminK = tmin + 273.16;
  const rnl = rso > 0 ? 4.903e-9 * ((Math.pow(tmaxK, 4) + Math.pow(tminK, 4)) / 2) * (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * Math.min(1, rs / rso) - 0.35) : 0; // Eq. 39, Rs/Rso capped at 1
  const rn = rns - rnl;
  const et0 = Math.max(0, (0.408 * slope * rn + gamma * (900 / (tmean + 273)) * wind * Math.max(0, es - ea)) / (slope + gamma * (1 + 0.34 * wind))); // Eq. 6, G=0 daily
  return { et0MmPerDay: et0, meanSaturationVapourPressureKpa: es, actualVapourPressureKpa: ea, slopeVapourPressureKpaPerC: slope, atmosphericPressureKpa: pressure, psychrometricConstantKpaPerC: gamma, netRadiationMJm2Day: rn, extraterrestrialRadiationMJm2Day: ra };
}
export function penmanMonteithET0(input: PenmanMonteithInput): number {
  return penmanMonteithDetails(input).et0MmPerDay;
}

/** FAO-56 Eq. 84: Ks = 1 at or below RAW, linear decline to 0 at TAW. */
export function stressCoefficient(depletionMm: number, totalAvailableMm: number, readilyAvailableMm: number): number {
  if (!(totalAvailableMm > 0) || readilyAvailableMm < 0 || readilyAvailableMm > totalAvailableMm) throw new InputError('Invalid TAW/RAW for stress coefficient');
  if (depletionMm <= readilyAvailableMm) return 1;
  if (depletionMm >= totalAvailableMm) return 0;
  return (totalAvailableMm - depletionMm) / (totalAvailableMm - readilyAvailableMm);
}

/** FAO-56 Chapter 6 Kc curve: constant ini, linear development, constant mid, linear late season. Day index is 0-based from the start of the initial stage. */
export function kcForDay(curve: KcCurve, dayIndex: number): number {
  const c = object(curve, 'kcCurve');
  const ini = num(c.kcIni, 0, 2.5, 'kcCurve.kcIni'), mid = num(c.kcMid, 0, 2.5, 'kcCurve.kcMid'), end = num(c.kcEnd, 0, 2.5, 'kcCurve.kcEnd');
  const s = object(c.stageLengthsDays, 'kcCurve.stageLengthsDays');
  const li = num(s.initial, 0, 365, 'stageLengthsDays.initial'), ld = num(s.development, 0, 365, 'stageLengthsDays.development');
  const lm = num(s.mid, 0, 365, 'stageLengthsDays.mid'), ll = num(s.late, 0, 365, 'stageLengthsDays.late');
  if (!Number.isInteger(dayIndex) || dayIndex < 0) throw new InputError('dayIndex must be a non-negative integer');
  if (dayIndex < li) return ini;
  if (dayIndex < li + ld) return ld === 0 ? mid : ini + (mid - ini) * ((dayIndex - li + 1) / ld);
  if (dayIndex < li + ld + lm) return mid;
  const lateDay = dayIndex - li - ld - lm;
  return ll === 0 || lateDay >= ll ? end : mid + (end - mid) * ((lateDay + 1) / ll);
}

// -------------------------------------------------------------------- parsing
function parseScheduleInput(value: unknown): ScheduleInput {
  const p = object(value, 'input');
  if (p.kind !== 'simulation') fail('kind must be simulation: this engine only produces simulated scenarios, never measured conditions');
  if (typeof p.inputNote !== 'string' || p.inputNote.length > 500 || p.inputNote.trim().length === 0) fail('inputNote must contain 1..500 characters describing assumptions');
  const retention = num(p.rainRetentionFraction, 0, 1, 'rainRetentionFraction');
  let station: ScheduleInput['station'];
  if (p.station !== undefined) {
    const s = object(p.station, 'station');
    station = { latitudeDeg: num(s.latitudeDeg, -66.5, 66.5, 'station.latitudeDeg'), elevationM: num(s.elevationM, -500, 9000, 'station.elevationM') };
  }
  let previous: number | undefined;
  const weather: AdvancedWeatherDay[] = array(p.weather, 1, 31, 'weather').map((entry, i) => {
    const w = object(entry, `weather[${i}]`);
    const epoch = dateEpoch(w.date, `weather[${i}].date`);
    if (previous !== undefined && epoch - previous !== 86400000) fail('weather dates must be consecutive daily dates in ascending order');
    previous = epoch;
    const rainMm = num(w.rainMm, 0, 1000, `weather[${i}].rainMm`);
    if (w.met !== undefined) {
      if (!station) fail(`weather[${i}].met requires station latitude/elevation`);
      const met = object(w.met, `weather[${i}].met`);
      const parsedMet: MetInput = { tmaxC: num(met.tmaxC, -60, 60, `weather[${i}].met.tmaxC`), tminC: num(met.tminC, -60, 60, `weather[${i}].met.tminC`), windMPerS: num(met.windMPerS, 0, 50, `weather[${i}].met.windMPerS`), solarRadiationMJm2Day: num(met.solarRadiationMJm2Day, 0, 50, `weather[${i}].met.solarRadiationMJm2Day`) };
      if (met.dewpointC !== undefined) parsedMet.dewpointC = num(met.dewpointC, -60, 60, `weather[${i}].met.dewpointC`);
      if (met.rhMaxPct !== undefined) parsedMet.rhMaxPct = num(met.rhMaxPct, 0, 100, `weather[${i}].met.rhMaxPct`);
      if (met.rhMinPct !== undefined) parsedMet.rhMinPct = num(met.rhMinPct, 0, 100, `weather[${i}].met.rhMinPct`);
      penmanMonteithDetails({ ...parsedMet, date: w.date as string, ...station }); // validates humidity inputs early
      return { date: w.date as string, rainMm, met: parsedMet };
    }
    return { date: w.date as string, rainMm, et0Mm: num(w.et0Mm, 0, 30, `weather[${i}].et0Mm`) };
  });
  const dates = new Set(weather.map(w => w.date));
  const fields: AdvancedFieldInput[] = array(p.fields, 1, 100, 'fields').map((entry, i) => {
    const label = `fields[${i}]`, f = object(entry, label), s = object(f.soil, `${label}.soil`);
    const fieldCapacity = num(s.fieldCapacity, 0, 1, `${label}.soil.fieldCapacity`);
    const wiltingPoint = num(s.wiltingPoint, 0, 1, `${label}.soil.wiltingPoint`);
    if (fieldCapacity <= wiltingPoint) fail(`${label}.soil.fieldCapacity must exceed wiltingPoint`);
    const rootDepthM = num(s.rootDepthM, 0.05, 3, `${label}.soil.rootDepthM`);
    const depletionFraction = num(s.depletionFraction, 0.05, 0.95, `${label}.soil.depletionFraction`);
    const taw = 1000 * (fieldCapacity - wiltingPoint) * rootDepthM;
    const soil: Soil = { fieldCapacity, wiltingPoint, rootDepthM, depletionFraction, initialDepletionMm: num(s.initialDepletionMm, 0, taw, `${label}.soil.initialDepletionMm`), targetDepletionFraction: num(s.targetDepletionFraction, 0, depletionFraction, `${label}.soil.targetDepletionFraction`) };
    const hasKc = f.kc !== undefined, hasCurve = f.kcCurve !== undefined;
    if (hasKc === hasCurve) fail(`${label} requires exactly one of kc or kcCurve`);
    const base: AdvancedFieldInput = { id: identifier(f.id, `${label}.id`), nodeId: identifier(f.nodeId, `${label}.nodeId`), areaHa: num(f.areaHa, 0.001, 100000, `${label}.areaHa`), applicationEfficiency: num(f.applicationEfficiency, 0.05, 1, `${label}.applicationEfficiency`), priority: num(f.priority, 0.1, 10, `${label}.priority`), soil };
    if (hasKc) base.kc = num(f.kc, 0, 2.5, `${label}.kc`);
    else { kcForDay(f.kcCurve as KcCurve, 0); base.kcCurve = f.kcCurve as KcCurve; }
    if (f.kcStartDayIndex !== undefined) {
      if (!Number.isInteger(f.kcStartDayIndex) || (f.kcStartDayIndex as number) < 0 || (f.kcStartDayIndex as number) > 3650) fail(`${label}.kcStartDayIndex must be an integer in 0..3650`);
      base.kcStartDayIndex = f.kcStartDayIndex as number;
    }
    return base;
  });
  if (new Set(fields.map(f => f.id)).size !== fields.length) fail('fields contains duplicate IDs');
  if (new Set(fields.map(f => f.nodeId)).size !== fields.length) fail('field nodes (one field per node supported)');
  const n = object(p.network, 'network');
  const nodes = array(n.nodes, 1, 200, 'network.nodes').map((id, i) => identifier(id, `network.nodes[${i}]`));
  if (new Set(nodes).size !== nodes.length) fail('network.nodes contains duplicate IDs');
  const nodeSet = new Set(nodes);
  const edges: AdvancedCanalInput[] = array(n.edges, 0, 200, 'network.edges').map((entry, i) => {
    const label = `network.edges[${i}]`, e = object(entry, label);
    if (typeof e.closed !== 'boolean') fail(`${label}.closed must be boolean`);
    const edge: AdvancedCanalInput = { id: identifier(e.id, `${label}.id`), from: identifier(e.from, `${label}.from`), to: identifier(e.to, `${label}.to`), maxFlowM3PerHour: flow(e.maxFlowM3PerHour, `${label}.maxFlowM3PerHour`), efficiency: num(e.efficiency, 0.05, 1, `${label}.efficiency`), closed: e.closed };
    if (e.volumeLimitM3 !== undefined) edge.volumeLimitM3 = num(e.volumeLimitM3, 0, 1e9, `${label}.volumeLimitM3`);
    if (e.closedDates !== undefined) {
      edge.closedDates = array(e.closedDates, 0, 31, `${label}.closedDates`).map((d, j) => {
        const date = d as string; dateEpoch(date, `${label}.closedDates[${j}]`);
        if (!dates.has(date)) fail(`${label}.closedDates must be dates inside the weather horizon`);
        return date;
      });
    }
    return edge;
  });
  if (new Set(edges.map(e => e.id)).size !== edges.length) fail('network.edges contains duplicate IDs');
  const network: ScheduleInput['network'] = { sourceId: identifier(n.sourceId, 'network.sourceId'), nodes, edges, supplyM3: num(n.supplyM3, 0, 1e9, 'network.supplyM3'), sourceMaxFlowM3PerHour: flow(n.sourceMaxFlowM3PerHour, 'network.sourceMaxFlowM3PerHour'), windowHoursPerDay: num(n.windowHoursPerDay, 0.01, 24, 'network.windowHoursPerDay') };
  if (n.supplyPerDayM3 !== undefined) network.supplyPerDayM3 = num(n.supplyPerDayM3, 0, 1e9, 'network.supplyPerDayM3');
  if (!nodeSet.has(network.sourceId)) fail('network.sourceId must be a network node');
  const parent = new Map<string, AdvancedCanalInput>();
  const children = new Map(nodes.map(id => [id, [] as AdvancedCanalInput[]]));
  for (const e of edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) fail(`canal ${e.id} has an unknown endpoint`);
    if (e.to === network.sourceId) fail(`canal ${e.id} enters the source`);
    if (parent.has(e.to)) fail(`node ${e.to} has multiple parents`);
    parent.set(e.to, e); children.get(e.from)!.push(e);
  }
  const colors = new Map<string, number>();
  const visit = (id: string): void => { if (colors.get(id) === 1) fail(`network contains a cycle at ${id}`); if (colors.get(id) === 2) return; colors.set(id, 1); for (const e of children.get(id)!) visit(e.to); colors.set(id, 2); };
  for (const id of nodes) visit(id);
  const reached = new Set<string>();
  const reach = (id: string, eff: number): void => { reached.add(id); for (const e of children.get(id)!) { const next = eff * e.efficiency; if (next < 1e-8) fail(`combined path efficiency to ${e.to} is below 1e-8`); reach(e.to, next); } };
  reach(network.sourceId, 1);
  if (reached.size !== nodes.length) fail('network contains disconnected nodes');
  for (const f of fields) if (!reached.has(f.nodeId)) fail(`field ${f.id} has an unknown or disconnected node`);
  return { kind: 'simulation', inputNote: p.inputNote, rainRetentionFraction: retention, ...(station ? { station } : {}), weather, fields, network };
}

// ------------------------------------------------------------------ scheduler
type Route = { path: AdvancedCanalInput[]; suffix: number[]; efficiency: number };
type RawEvent = { fieldIndex: number; seq: number; deadlineIndex: number; netIrrigationMm: number; grossDemandM3: number };

export function calculateSchedule(value: unknown): ScheduleResult {
  const p = parseScheduleInput(value);
  const fields = [...p.fields].sort((a, b) => cmp(a.id, b.id));
  const edges = [...p.network.edges].sort((a, b) => cmp(a.id, b.id));
  const n = p.network, days = p.weather.length;
  const et0 = p.weather.map(w => w.met ? penmanMonteithET0({ ...w.met, date: w.date, latitudeDeg: p.station!.latitudeDeg, elevationM: p.station!.elevationM }) : w.et0Mm!);
  const kcOf = (f: AdvancedFieldInput, day: number): number => f.kcCurve ? kcForDay(f.kcCurve, day + (f.kcStartDayIndex ?? 0)) : f.kc!;
  const parent = new Map(edges.map(e => [e.to, e]));
  const routes: Route[] = fields.map(f => {
    const path: AdvancedCanalInput[] = [];
    let node = f.nodeId;
    while (node !== n.sourceId) { const e = parent.get(node)!; path.push(e); node = e.from; }
    path.reverse();
    const suffix: number[] = new Array(path.length);
    let efficiency = 1;
    for (let j = path.length - 1; j >= 0; j--) { efficiency *= path[j].efficiency; suffix[j] = efficiency; }
    return { path, suffix, efficiency };
  });
  const closedOn = (e: AdvancedCanalInput, day: number): boolean => e.closed || (e.closedDates?.includes(p.weather[day].date) ?? false);
  const routeRate = (fi: number, day: number): number => {
    const r = routes[fi];
    if (r.path.some(e => closedOn(e, day))) return 0;
    let rate = n.sourceMaxFlowM3PerHour * r.efficiency;
    r.path.forEach((e, j) => { rate = Math.min(rate, e.maxFlowM3PerHour * r.suffix[j]); });
    return rate;
  };
  const tawOf = (f: AdvancedFieldInput): number => 1000 * (f.soil.fieldCapacity - f.soil.wiltingPoint) * f.soil.rootDepthM;

  // Daily balance (FAO-56 Eq. 85, no capillary rise / groundwater / salinity).
  function simulate(fi: number, irrigationRootMm: number[]): { daily: DailyState[]; retainedIrrigationMm: number } {
    const f = fields[fi], taw = tawOf(f), raw = f.soil.depletionFraction * taw;
    let dr = f.soil.initialDepletionMm, retained = 0;
    const daily = p.weather.map((w, day) => {
      const kc = kcOf(f, day), ks = stressCoefficient(dr, taw, raw);
      const effRain = w.rainMm * p.rainRetentionFraction, irr = irrigationRootMm[day] ?? 0;
      // Physical bound (audit M01): actual ET cannot extract more water than
      // the root zone holds plus today's inputs. FAO-56 Eq. 85 with Dr clipped
      // to [0, TAW] otherwise hides the residual as lost mass.
      const availableMm = Math.max(0, taw - dr + effRain + irr);
      const etcPotential = ks * kc * et0[day];
      const etc = Math.min(etcPotential, availableMm);
      const rawEnd = dr + etc - effRain - irr;
      const drainage = Math.max(0, -rawEnd);
      const end = Math.min(taw, Math.max(0, rawEnd));
      const inflow = effRain + irr;
      retained += irr - (inflow > 0 ? drainage * (irr / inflow) : 0);
      const state: DailyState = { date: w.date, et0Mm: et0[day], kc, ks, etCropMm: etc, effectiveRainMm: effRain, irrigationRootZoneMm: irr, drainageMm: drainage, startDepletionMm: dr, endDepletionMm: end, stress: ks < 1 - 1e-12, etLimitedByAvailableWater: etc < etcPotential - 1e-12 };
      dr = end;
      return state;
    });
    return { daily, retainedIrrigationMm: retained };
  }

  // Ideal (timely) events: irrigate on the day projected depletion would pass RAW, refilling to target.
  const rawEvents: RawEvent[] = [];
  const noIrrigation: { daily: DailyState[]; retainedIrrigationMm: number }[] = [];
  fields.forEach((f, fi) => {
    noIrrigation.push(simulate(fi, new Array(days).fill(0)));
    const taw = tawOf(f), raw = f.soil.depletionFraction * taw, target = f.soil.targetDepletionFraction * taw;
    let dr = f.soil.initialDepletionMm, seq = 0;
    p.weather.forEach((w, day) => {
      const projected = dr + kcOf(f, day) * et0[day] - w.rainMm * p.rainRetentionFraction;
      if (projected - raw > 1e-10 * Math.max(1, taw)) {
        const net = projected - target;
        rawEvents.push({ fieldIndex: fi, seq: seq++, deadlineIndex: day, netIrrigationMm: net, grossDemandM3: (net * f.areaHa * 10) / f.applicationEfficiency });
        dr = target;
      } else dr = Math.min(taw, Math.max(0, projected));
    });
  });

  // Resources shared across the horizon.
  const gateRemain = new Array<number>(days).fill(n.windowHoursPerDay);
  let supplyRemain = n.supplyM3;
  const supplyDayRemain = new Array<number>(days).fill(n.supplyPerDayM3 ?? Infinity);
  const canalDayRemain = new Map<string, number>(), canalTotalRemain = new Map<string, number>();
  for (const e of edges) {
    canalTotalRemain.set(e.id, e.volumeLimitM3 ?? Infinity);
    for (let d = 0; d < days; d++) canalDayRemain.set(`${e.id}|${d}`, e.maxFlowM3PerHour * n.windowHoursPerDay);
  }
  const tol = 1e-9;
  type Chunk = { eventIndex: number; day: number; gateVolumeM3: number; rate: number };
  const chunks: Chunk[] = [];
  const ordered = rawEvents.map((e, i) => ({ e, i })).sort((a, b) =>
    a.e.deadlineIndex - b.e.deadlineIndex || fields[b.e.fieldIndex].priority - fields[a.e.fieldIndex].priority ||
    cmp(fields[a.e.fieldIndex].id, fields[b.e.fieldIndex].id) || a.e.seq - b.e.seq);
  const allocatedByEvent = new Array<number>(rawEvents.length).fill(0);
  const reasonsByEvent: string[][] = rawEvents.map(() => []);
  for (const { e, i } of ordered) {
    const fi = e.fieldIndex, route = routes[fi];
    let remaining = e.grossDemandM3;
    // Latest-feasible-day first: avoids applying water long before it is needed (and draining it).
    for (let day = e.deadlineIndex; day >= 0 && remaining > tol; day--) {
      const rate = routeRate(fi, day);
      if (rate <= 0) continue;
      let maxGate = Math.min(rate * gateRemain[day], supplyRemain * route.efficiency, supplyDayRemain[day] * route.efficiency);
      route.path.forEach((edge, j) => { maxGate = Math.min(maxGate, canalDayRemain.get(`${edge.id}|${day}`)! * route.suffix[j], canalTotalRemain.get(edge.id)! * route.suffix[j]); });
      const volume = Math.min(remaining, maxGate);
      if (volume <= 1e-9) continue;
      chunks.push({ eventIndex: i, day, gateVolumeM3: volume, rate });
      gateRemain[day] -= volume / rate;
      supplyRemain -= volume / route.efficiency;
      supplyDayRemain[day] -= volume / route.efficiency;
      route.path.forEach((edge, j) => {
        canalDayRemain.set(`${edge.id}|${day}`, canalDayRemain.get(`${edge.id}|${day}`)! - volume / route.suffix[j]);
        canalTotalRemain.set(edge.id, canalTotalRemain.get(edge.id)! - volume / route.suffix[j]);
      });
      allocatedByEvent[i] += volume; remaining -= volume;
    }
    if (remaining > 1e-6) {
      const reasons = reasonsByEvent[i], feasible = Array.from({ length: e.deadlineIndex + 1 }, (_, d) => d);
      const openDays = feasible.filter(d => routeRate(fi, d) > 0);
      if (openDays.length === 0) {
        for (const edge of route.path) {
          if (edge.closed) reasons.push(`closed-route:${edge.id}`);
          else if (feasible.every(d => edge.closedDates?.includes(p.weather[d].date))) reasons.push(`canal-closure:${edge.id}`);
          else if (edge.maxFlowM3PerHour === 0) reasons.push(`zero-rate:${edge.id}`);
        }
        if (n.sourceMaxFlowM3PerHour === 0) reasons.push('source-rate-zero');
        if (reasons.length === 0) reasons.push('route-unavailable-before-deadline');
      } else {
        if (supplyRemain <= 1e-6) reasons.push('source-supply');
        if (openDays.every(d => supplyDayRemain[d] <= 1e-6)) reasons.push('daily-supply-limit');
        if (openDays.every(d => gateRemain[d] <= 1e-9)) reasons.push('gate-window-before-deadline');
        for (const edge of route.path) {
          if (canalTotalRemain.get(edge.id)! <= 1e-6) reasons.push(`canal-volume-limit:${edge.id}`);
          else if (openDays.every(d => canalDayRemain.get(`${edge.id}|${d}`)! <= 1e-6)) reasons.push(`canal-capacity:${edge.id}`);
          if (feasible.some(d => closedOn(edge, d)) && !edge.closed) reasons.push(`canal-closure:${edge.id}`);
        }
        if (reasons.length === 0) reasons.push('insufficient-capacity-before-deadline');
      }
    }
  }

  const events: IrrigationEvent[] = rawEvents.map((e, i): IrrigationEvent => {
    const allocated = allocatedByEvent[i], unmet = Math.max(0, e.grossDemandM3 - allocated);
    return { eventId: `${fields[e.fieldIndex].id}#${e.seq + 1}`, fieldId: fields[e.fieldIndex].id, deadlineDate: p.weather[e.deadlineIndex].date, netIrrigationMm: e.netIrrigationMm, grossDemandM3: e.grossDemandM3, allocatedM3: allocated, unmetM3: unmet, status: unmet <= 1e-6 ? 'scheduled' : allocated <= 1e-9 ? 'impossible-before-deadline' : 'partially-scheduled', bindingConstraints: [...new Set(reasonsByEvent[i])].sort(cmp), feasibilityProven: false as const };
  }).sort((a, b) => cmp(a.deadlineDate, b.deadlineDate) || cmp(a.fieldId, b.fieldId) || cmp(a.eventId, b.eventId));
  const eventOrder = new Map(ordered.map(({ i }, rank) => [i, rank]));
  const deliveries: Delivery[] = [];
  {
    const byDay = new Map<number, number>();
    for (const chunk of [...chunks].sort((a, b) => a.day - b.day || eventOrder.get(a.eventIndex)! - eventOrder.get(b.eventIndex)!)) {
      const e = rawEvents[chunk.eventIndex], fi = e.fieldIndex, duration = chunk.gateVolumeM3 / chunk.rate;
      const start = byDay.get(chunk.day) ?? 0;
      byDay.set(chunk.day, start + duration);
      deliveries.push({ fieldId: fields[fi].id, eventId: `${fields[fi].id}#${e.seq + 1}`, date: p.weather[chunk.day].date, startHour: start, endHour: start + duration, durationHours: duration, gateFlowM3PerHour: chunk.rate, sourceFlowM3PerHour: chunk.rate / routes[fi].efficiency, gateVolumeM3: chunk.gateVolumeM3, sourceVolumeM3: chunk.gateVolumeM3 / routes[fi].efficiency });
    }
  }

  const fieldSchedules: FieldSchedule[] = fields.map((f, fi) => {
    const irrigationRootMm = new Array<number>(days).fill(0);
    for (const d of deliveries.filter(x => x.fieldId === f.id)) {
      const day = p.weather.findIndex(w => w.date === d.date);
      irrigationRootMm[day] += (d.gateVolumeM3 * f.applicationEfficiency) / (f.areaHa * 10);
    }
    const scheduled = simulate(fi, irrigationRootMm), none = noIrrigation[fi];
    const taw = tawOf(f), raw = f.soil.depletionFraction * taw;
    const firstStress = none.daily.find(d => d.endDepletionMm > raw + 1e-10 * Math.max(1, taw))?.date ?? null;
    const allocated = sum(events.filter(e => e.fieldId === f.id).map(e => e.allocatedM3));
    const demanded = sum(events.filter(e => e.fieldId === f.id).map(e => e.grossDemandM3));
    return { fieldId: f.id, totalAvailableMm: taw, readilyAvailableMm: raw, firstStressDateWithoutIrrigation: firstStress, stressDaysWithoutIrrigation: none.daily.filter(d => d.stress).length, allocatedGateM3: allocated, unmetGateM3: Math.max(0, demanded - allocated), stressDaysScheduled: scheduled.daily.filter(d => d.stress).length, minimumKsScheduled: Math.min(...scheduled.daily.map(d => d.ks)), cumulativeStressIndex: sum(scheduled.daily.map(d => 1 - d.ks)), dailyNoIrrigation: none.daily, dailyScheduled: scheduled.daily };
  });
  const scheduledRetainedM3 = fields.reduce((total, f, fi) => {
    const irrigationRootMm = new Array<number>(days).fill(0);
    for (const d of deliveries.filter(x => x.fieldId === f.id)) irrigationRootMm[p.weather.findIndex(w => w.date === d.date)] += (d.gateVolumeM3 * f.applicationEfficiency) / (f.areaHa * 10);
    return total + simulate(fi, irrigationRootMm).retainedIrrigationMm * f.areaHa * 10;
  }, 0);
  const grossDemandM3 = sum(events.map(e => e.grossDemandM3)), allocatedGateM3 = sum(events.map(e => e.allocatedM3));
  const sourceUsedM3 = sum(deliveries.map(d => d.sourceVolumeM3));
  const rootZoneDeliveredM3 = sum(fields.map(f => sum(deliveries.filter(d => d.fieldId === f.id).map(d => d.gateVolumeM3)) * f.applicationEfficiency));
  const warnings = [
    'All outputs are simulated scenarios from supplied inputs; nothing here is a measured field, canal, or supply condition.',
    'No water-saving or yield improvement is claimed. Stress indices (Ks, cumulative 1-Ks) are water-balance indicators, not yield predictions.',
  ];
  for (const e of events) if (e.unmetM3 > 1e-6) warnings.push(`Event ${e.eventId} (${e.fieldId}, deadline ${e.deadlineDate}): unmet gate demand ${e.unmetM3} m3; binding constraints: ${e.bindingConstraints.join(', ') || 'none identified'}.`);
  return {
    version: 'ariq-irrigation-v2', kind: 'simulation', inputNote: p.inputNote,
    method: 'FAO-56 Penman-Monteith ET0 (Eq. 6, or caller-supplied ET0), ETc = Kc*ET0 (Eq. 58), ETc adj = Ks*Kc*ET0 (Eq. 81), TAW/RAW (Eqs. 82-83), Ks (Eq. 84), daily root-zone balance (Eq. 85); CROPWAT-style daily soil-water-balance scheduling.',
    objective: 'Deterministic greedy heuristic, not a claimed global optimum: irrigation events are ordered by (deadline ascending, priority descending, fieldId, event sequence); each event is filled to its gross demand as late as feasible on or before its deadline subject to total and daily supply, serial gate time per day, per-canal daily flow capacity, canal volume limits, closures, and conveyance losses. Reported objective value: weightedUnmetPriorityM3 = sum over events of field priority * unmet gate m3 (lower is better under this stated objective).',
    assumptions: [
      'Effective precipitation = rainMm * rainRetentionFraction, a caller scenario assumption (not the monthly USDA-SCS formula, which is not valid at a daily step). Excess water above field capacity drains the same day; no runoff dynamics, infiltration-rate limit, capillary rise, groundwater, or salinity is modelled.',
      'Ks is evaluated from start-of-day depletion. Timely-event generation assumes standard (unstressed) ETc because irrigation is assumed available on the trigger day; the scheduled trajectory then re-simulates with Ks-adjusted ETc and actual deliveries.',
      'One field gate operates at a time (serial scheduling, as in ariq-irrigation-v1). Canal hydraulics, travel time, and concurrent flows are not simulated.',
      'An event deadline is the first day projected depletion would exceed RAW without irrigation. Deliveries after a deadline are never scheduled; unmet volume is reported instead.',
      'Kc curves start their initial stage on the first weather date. Supplied Kc/Kc-curve, soil, priority, efficiency, supply, and network values require local agronomic justification; none are calibrated defaults.',
      'Priorities are user preferences. They affect only ordering under scarcity and do not establish agronomic or economic optimality.',
    ],
    fields: fieldSchedules, events, deliveries,
    totals: { grossDemandM3, allocatedGateM3, unmetGateM3: Math.max(0, grossDemandM3 - allocatedGateM3), weightedUnmetPriorityM3: sum(events.map(e => e.unmetM3 * fields.find(f => f.id === e.fieldId)!.priority)), sourceUsedM3, unusedSupplyM3: Math.max(0, n.supplyM3 - sourceUsedM3), conveyanceLossM3: Math.max(0, sourceUsedM3 - allocatedGateM3), applicationLossM3: Math.max(0, allocatedGateM3 - rootZoneDeliveredM3), rootZoneDeliveredM3, rootZoneRetainedM3: scheduledRetainedM3, drainageMmTotal: sum(fieldSchedules.flatMap(f => f.dailyScheduled.map(d => d.drainageMm))), stressDaysScheduled: sum(fieldSchedules.map(f => f.stressDaysScheduled)), stressDaysWithoutIrrigation: sum(fieldSchedules.map(f => f.stressDaysWithoutIrrigation)), eventsScheduled: events.filter(e => e.status === 'scheduled').length, eventsImpossible: events.filter(e => e.status === 'impossible-before-deadline').length },
    warnings,
  };
}

export type FieldOutlook = {
  fieldId: string; totalAvailableMm: number; readilyAvailableMm: number;
  firstStressDateWithoutIrrigation: string | null; stressDaysWithoutIrrigation: number;
  dailyNoIrrigation: DailyState[];
  irrigationEvents: { eventId: string; deadlineDate: string; netIrrigationMm: number; grossDemandM3: number }[];
  totalNetIrrigationMm: number; totalGrossDemandM3: number;
};
/**
 * Demand/stress outlook for one field, reusing the exact daily balance and
 * timely-event generation of calculateSchedule. Allocation is deliberately
 * not performed: a zero-supply placeholder network is used internally and
 * every allocation field is stripped, so no supply is invented or implied.
 */
export function calculateFieldOutlook(field: AdvancedFieldInput, weather: AdvancedWeatherDay[], rainRetentionFraction: number, station?: { latitudeDeg: number; elevationM: number }): FieldOutlook {
  const plan: ScheduleInput = {
    kind: 'simulation', inputNote: 'Field outlook: demand and stress only; no supply, canal, or delivery schedule is represented.',
    rainRetentionFraction, ...(station ? { station } : {}), weather, fields: [field],
    network: { sourceId: 'source', nodes: ['source', field.nodeId], supplyM3: 0, sourceMaxFlowM3PerHour: 1, windowHoursPerDay: 1, edges: field.nodeId === 'source' ? [] : [{ id: 'outlook-link', from: 'source', to: field.nodeId, maxFlowM3PerHour: 1, efficiency: 1, closed: false }] },
  };
  const result = calculateSchedule(plan);
  const f = result.fields[0];
  return {
    fieldId: f.fieldId, totalAvailableMm: f.totalAvailableMm, readilyAvailableMm: f.readilyAvailableMm,
    firstStressDateWithoutIrrigation: f.firstStressDateWithoutIrrigation, stressDaysWithoutIrrigation: f.stressDaysWithoutIrrigation,
    dailyNoIrrigation: f.dailyNoIrrigation,
    irrigationEvents: result.events.map(e => ({ eventId: e.eventId, deadlineDate: e.deadlineDate, netIrrigationMm: e.netIrrigationMm, grossDemandM3: e.grossDemandM3 })),
    totalNetIrrigationMm: result.events.reduce((s, e) => s + e.netIrrigationMm, 0),
    totalGrossDemandM3: result.events.reduce((s, e) => s + e.grossDemandM3, 0),
  };
}

