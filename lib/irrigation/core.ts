export type WeatherDay = { date: string; et0Mm: number; rainMm: number };
export type Soil = { fieldCapacity: number; wiltingPoint: number; rootDepthM: number; depletionFraction: number; initialDepletionMm: number; targetDepletionFraction: number };
export type FieldInput = { id: string; nodeId: string; areaHa: number; kc: number; applicationEfficiency: number; priority: number; soil: Soil };
export type CanalInput = { id: string; from: string; to: string; maxFlowM3PerHour: number; efficiency: number; closed: boolean; volumeLimitM3?: number };
export type NetworkInput = { sourceId: string; nodes: string[]; supplyM3: number; sourceMaxFlowM3PerHour: number; windowHours: number; edges: CanalInput[] };
export type PlanInput = { kind: 'simulation'; inputNote: string; rainRetentionFraction: number; weather: WeatherDay[]; fields: FieldInput[]; network: NetworkInput };
export type DailyDemand = { date: string; etCropMm: number; effectiveRainMm: number; drainageMm: number; netIrrigationMm: number; endDepletionMm: number };
export type FieldDemand = { fieldId: string; totalAvailableMm: number; readilyAvailableMm: number; netIrrigationMm: number; grossDemandM3: number; firstStressDateWithoutIrrigation: string | null; daily: DailyDemand[] };
export type FieldAllocation = { fieldId: string; requestedM3: number; allocatedM3: number; unmetM3: number; fulfillment: number; sourceRequiredM3: number; conveyanceLossM3: number; applicationLossM3: number; rootZoneM3: number; maxGateFlowM3PerHour: number; durationHours: number; bindingConstraints: string[] };
export type CanalUse = { id: string; inletM3: number; outletM3: number; lossM3: number; capacityM3: number; closed: boolean };
export type GateSlot = { fieldId: string; startHour: number; endHour: number; gateFlowM3PerHour: number; sourceFlowM3PerHour: number; gateVolumeM3: number; sourceVolumeM3: number };
export type PlanResult = { version: 'ariq-irrigation-v1'; kind: 'simulation'; inputNote: string; method: string; assumptions: string[]; demands: FieldDemand[]; allocations: FieldAllocation[]; canals: CanalUse[]; schedule: GateSlot[]; totals: { availableM3: number; sourceUsedM3: number; unusedM3: number; fieldGateM3: number; rootZoneM3: number; conveyanceLossM3: number; applicationLossM3: number; requestedM3: number; unmetM3: number; scheduledHours: number }; warnings: string[] };

export class InputError extends Error {
  constructor(message: string) { super(message); this.name = 'InputError'; }
}

type Obj = Record<string, unknown>;
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const tolerance = (value: number): number => 1e-9 * Math.max(1, Math.abs(value));
function fail(message: string): never { throw new InputError(message); }
function object(value: unknown, label: string): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Obj;
}
function number(value: unknown, low: number, high: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${label} must be a finite number in [${low}, ${high}]`);
  return value;
}
function flow(value: unknown, label: string): number {
  const result = number(value, 0, 1e7, label);
  if (result > 0 && result < 1e-6) fail(`${label} must be zero or at least 0.000001 m3/hour`);
  return result;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(`${label} must match ${idPattern.source}`);
  return value;
}
function array(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must be an array with ${min}..${max} entries`);
  return value;
}
function unique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) fail(`${label} contains duplicate IDs`);
}
function dateEpoch(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') fail(`${label} must be a valid YYYY-MM-DD calendar date (year 0001..9999)`);
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) fail(`${label} is not a valid calendar date`);
  return epoch;
}
function parseWeather(value: unknown): WeatherDay[] {
  let previous: number | undefined;
  return array(value, 1, 14, 'weather').map((entry, i) => {
    const w = object(entry, `weather[${i}]`);
    const epoch = dateEpoch(w.date, `weather[${i}].date`);
    if (previous !== undefined && epoch - previous !== 86400000) fail('weather dates must be consecutive daily dates in ascending order');
    previous = epoch;
    return { date: w.date as string, et0Mm: number(w.et0Mm, 0, 30, `weather[${i}].et0Mm`), rainMm: number(w.rainMm, 0, 1000, `weather[${i}].rainMm`) };
  });
}
function parseField(value: unknown, label: string): FieldInput {
  const f = object(value, label);
  const s = object(f.soil, `${label}.soil`);
  const fieldCapacity = number(s.fieldCapacity, 0, 1, `${label}.soil.fieldCapacity`);
  const wiltingPoint = number(s.wiltingPoint, 0, 1, `${label}.soil.wiltingPoint`);
  if (fieldCapacity <= wiltingPoint) fail(`${label}.soil.fieldCapacity must exceed wiltingPoint`);
  const rootDepthM = number(s.rootDepthM, 0.05, 3, `${label}.soil.rootDepthM`);
  const depletionFraction = number(s.depletionFraction, 0.05, 0.95, `${label}.soil.depletionFraction`);
  const taw = 1000 * (fieldCapacity - wiltingPoint) * rootDepthM;
  const soil: Soil = { fieldCapacity, wiltingPoint, rootDepthM, depletionFraction,
    initialDepletionMm: number(s.initialDepletionMm, 0, taw, `${label}.soil.initialDepletionMm`),
    targetDepletionFraction: number(s.targetDepletionFraction, 0, depletionFraction, `${label}.soil.targetDepletionFraction`) };
  return { id: identifier(f.id, `${label}.id`), nodeId: identifier(f.nodeId, `${label}.nodeId`), areaHa: number(f.areaHa, 0.001, 100000, `${label}.areaHa`), kc: number(f.kc, 0, 2.5, `${label}.kc`), applicationEfficiency: number(f.applicationEfficiency, 0.05, 1, `${label}.applicationEfficiency`), priority: number(f.priority, 0.1, 10, `${label}.priority`), soil };
}
function parsePlan(value: unknown): PlanInput {
  const p = object(value, 'input');
  if (p.kind !== 'simulation') fail('kind must be simulation');
  if (typeof p.inputNote !== 'string' || p.inputNote.length > 500 || p.inputNote.trim().length === 0) fail('inputNote must contain 1..500 characters describing assumptions');
  const rainRetentionFraction = number(p.rainRetentionFraction, 0, 1, 'rainRetentionFraction');
  const weather = parseWeather(p.weather);
  const fields = array(p.fields, 1, 100, 'fields').map((f, i) => parseField(f, `fields[${i}]`));
  unique(fields.map(f => f.id), 'fields');
  unique(fields.map(f => f.nodeId), 'field nodes (one field per node supported)');
  const n = object(p.network, 'network');
  const nodes = array(n.nodes, 1, 200, 'network.nodes').map((id, i) => identifier(id, `network.nodes[${i}]`));
  unique(nodes, 'network.nodes');
  const edges = array(n.edges, 0, 200, 'network.edges').map((entry, i): CanalInput => {
    const e = object(entry, `network.edges[${i}]`);
    if (typeof e.closed !== 'boolean') fail(`network.edges[${i}].closed must be boolean`);
    return { id: identifier(e.id, `network.edges[${i}].id`), from: identifier(e.from, `network.edges[${i}].from`), to: identifier(e.to, `network.edges[${i}].to`), maxFlowM3PerHour: flow(e.maxFlowM3PerHour, `network.edges[${i}].maxFlowM3PerHour`), efficiency: number(e.efficiency, 0.05, 1, `network.edges[${i}].efficiency`), closed: e.closed, ...(e.volumeLimitM3===undefined?{}:{volumeLimitM3:number(e.volumeLimitM3,0,1e9,`network.edges[${i}].volumeLimitM3`)}) };
  });
  unique(edges.map(e => e.id), 'network.edges');
  const network: NetworkInput = { sourceId: identifier(n.sourceId, 'network.sourceId'), nodes, edges, supplyM3: number(n.supplyM3, 0, 1e9, 'network.supplyM3'), sourceMaxFlowM3PerHour: flow(n.sourceMaxFlowM3PerHour, 'network.sourceMaxFlowM3PerHour'), windowHours: number(n.windowHours, 0.01, 336, 'network.windowHours') };
  const nodeSet = new Set(nodes);
  if (!nodeSet.has(network.sourceId)) fail('network.sourceId must be a network node');
  const parent = new Map<string, CanalInput>();
  const children = new Map(nodes.map(id => [id, [] as CanalInput[]]));
  for (const e of edges) {
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) fail(`canal ${e.id} has an unknown endpoint`);
    if (e.to === network.sourceId) fail(`canal ${e.id} enters the source`);
    if (parent.has(e.to)) fail(`node ${e.to} has multiple parents`);
    parent.set(e.to, e);
    children.get(e.from)!.push(e);
  }
  const colors = new Map<string, number>();
  function visit(id: string): void {
    if (colors.get(id) === 1) fail(`network contains a cycle at ${id}`);
    if (colors.get(id) === 2) return;
    colors.set(id, 1);
    for (const e of children.get(id)!) visit(e.to);
    colors.set(id, 2);
  }
  for (const id of nodes) visit(id);
  const reached = new Set<string>();
  function reach(id: string, efficiency: number): void {
    reached.add(id);
    for (const e of children.get(id)!) {
      const next = efficiency * e.efficiency;
      if (next < 1e-8) fail(`combined path efficiency to ${e.to} is below 1e-8`);
      reach(e.to, next);
    }
  }
  reach(network.sourceId, 1);
  if (reached.size !== nodes.length) fail('network contains disconnected nodes');
  for (const f of fields) if (!reached.has(f.nodeId)) fail(`field ${f.id} has an unknown or disconnected node`);
  return { kind: 'simulation', inputNote: p.inputNote, rainRetentionFraction, weather, fields, network };
}

function demandFor(field: FieldInput, weather: WeatherDay[], retention: number): FieldDemand {
  const s = field.soil;
  const taw = 1000 * (s.fieldCapacity - s.wiltingPoint) * s.rootDepthM;
  const raw = s.depletionFraction * taw;
  let plannedDr = s.initialDepletionMm;
  let unirrigatedDr = plannedDr;
  let firstStressDateWithoutIrrigation: string | null = null;
  const daily: DailyDemand[] = [];
  for (const day of weather) {
    const etCropMm = field.kc * day.et0Mm;
    const effectiveRainMm = day.rainMm * retention;
    const potential = plannedDr + etCropMm - effectiveRainMm;
    const drainageMm = Math.max(0, -potential);
    const pre = Math.max(0, potential);
    const netIrrigationMm = pre - raw > 1e-10 * Math.max(1, taw) ? pre - s.targetDepletionFraction * taw : 0;
    plannedDr = Math.max(0, pre - netIrrigationMm);
    const noIrrigationPre = unirrigatedDr + etCropMm - effectiveRainMm;
    if (firstStressDateWithoutIrrigation === null && noIrrigationPre - raw > 1e-10 * Math.max(1, taw)) firstStressDateWithoutIrrigation = day.date;
    unirrigatedDr = Math.min(taw, Math.max(0, noIrrigationPre));
    daily.push({ date: day.date, etCropMm, effectiveRainMm, drainageMm, netIrrigationMm, endDepletionMm: plannedDr });
  }
  const netIrrigationMm = sum(daily.map(d => d.netIrrigationMm));
  return { fieldId: field.id, totalAvailableMm: taw, readilyAvailableMm: raw, netIrrigationMm, grossDemandM3: netIrrigationMm * field.areaHa * 10 / field.applicationEfficiency, firstStressDateWithoutIrrigation, daily };
}

export function calculateFieldDemand(field: FieldInput, weather: WeatherDay[], rainRetentionFraction: number): FieldDemand {
  return demandFor(parseField(field, 'field'), parseWeather(weather), number(rainRetentionFraction, 0, 1, 'rainRetentionFraction'));
}

type Route = { path: CanalInput[]; suffix: number[]; efficiency: number; rate: number; blocked: string[] };
type Resource = { label: string; cap: number; coefficients: number[] };
function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Internal irrigation invariant failed: ${message}`);
}
function bounded(used: number, cap: number, label: string): void {
  invariant(Number.isFinite(used) && used >= 0 && used <= cap + tolerance(cap), `${label} capacity`);
}
function equal(a: number, b: number, label: string): void {
  invariant(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance(Math.max(Math.abs(a), Math.abs(b))), label);
}

export function calculatePlan(input: unknown): PlanResult {
  const p = parsePlan(input);
  const fields = [...p.fields].sort((a, b) => cmp(a.id, b.id));
  const edges = [...p.network.edges].sort((a, b) => cmp(a.id, b.id));
  const n = p.network;
  const demands = fields.map(f => demandFor(f, p.weather, p.rainRetentionFraction));
  const parent = new Map(edges.map(e => [e.to, e]));
  const routes: Route[] = fields.map(f => {
    const path: CanalInput[] = [];
    let node = f.nodeId;
    while (node !== n.sourceId) {
      const edge = parent.get(node)!;
      path.push(edge);
      node = edge.from;
    }
    path.reverse();
    const suffix: number[] = new Array(path.length);
    let efficiency = 1;
    for (let j = path.length - 1; j >= 0; j--) { efficiency *= path[j].efficiency; suffix[j] = efficiency; }
    let rate = n.sourceMaxFlowM3PerHour * efficiency;
    const blocked: string[] = [];
    if (n.sourceMaxFlowM3PerHour === 0) blocked.push('source-rate-zero');
    path.forEach((e, j) => {
      rate = Math.min(rate, e.maxFlowM3PerHour * suffix[j]);
      if (e.closed) { rate = 0; blocked.push(`closed-route:${e.id}`); }
      if (e.maxFlowM3PerHour === 0) blocked.push(`zero-rate:${e.id}`);
    });
    return { path, suffix, efficiency, rate, blocked };
  });
  const resources: Resource[] = [
    { label: 'source-supply', cap: n.supplyM3, coefficients: routes.map(r => 1 / r.efficiency) },
    ...edges.map(e => ({ label: `canal:${e.id}`, cap: e.closed ? 0 : Math.min(e.volumeLimitM3??Infinity,e.maxFlowM3PerHour * n.windowHours), coefficients: routes.map(r => { const j = r.path.findIndex(step => step.id === e.id); return j < 0 ? 0 : 1 / r.suffix[j]; }) })),
    { label: 'gate-window', cap: n.windowHours, coefficients: routes.map(r => r.rate > 0 ? 1 / r.rate : 0) }
  ];
  const requests = demands.map(d => d.grossDemandM3);
  const allocated = fields.map(() => 0);
  const slopes = fields.map((f, i) => requests[i] * f.priority);
  const active = new Set(fields.map((_, i) => i).filter(i => requests[i] > 0 && routes[i].rate > 0));
  let iterations = 0;
  while (active.size > 0) {
    invariant(++iterations <= fields.length + resources.length + 4, 'progressive filling did not converge');
    const demandSteps = fields.map((_, i) => active.has(i) ? Math.max(0, requests[i] - allocated[i]) / slopes[i] : Infinity);
    const resourceSteps = resources.map(r => {
      const used = sum(allocated.map((x, i) => x * r.coefficients[i]));
      const slope = sum([...active].map(i => slopes[i] * r.coefficients[i]));
      return slope > 0 ? Math.max(0, r.cap - used) / slope : Infinity;
    });
    const step = Math.min(...demandSteps, ...resourceSteps);
    invariant(Number.isFinite(step) && step >= 0, 'invalid filling increment');
    for (const i of active) allocated[i] = Math.min(requests[i], allocated[i] + step * slopes[i]);
    const stepClose = (candidate: number): boolean => Number.isFinite(candidate) && Math.abs(candidate - step) <= 1e-12 * Math.max(Math.abs(candidate), Math.abs(step), Number.MIN_VALUE);
    const saturated = resources.filter((_, j) => stepClose(resourceSteps[j]));
    let removed = 0;
    for (const i of [...active]) {
      if (stepClose(demandSteps[i]) || saturated.some(r => r.coefficients[i] > 0)) { active.delete(i); removed++; }
    }
    invariant(removed > 0, 'filling iteration made no progress');
  }
  const usage = resources.map(r => sum(allocated.map((x, i) => x * r.coefficients[i])));
  resources.forEach((r, j) => bounded(usage[j], r.cap, r.label));
  const allocations: FieldAllocation[] = fields.map((f, i) => {
    const x = allocated[i];
    bounded(x, requests[i], `field ${f.id} demand`);
    const sourceRequiredM3 = x / routes[i].efficiency;
    const rootZoneM3 = x * f.applicationEfficiency;
    const bindingConstraints = routes[i].blocked.slice();
    if (requests[i] === 0 || Math.abs(x - requests[i]) <= tolerance(requests[i])) bindingConstraints.push('demand-met');
    if (requests[i] > 0) resources.forEach((r, j) => {
      if (r.coefficients[i] > 0 && Math.abs(usage[j] - r.cap) <= tolerance(r.cap)) bindingConstraints.push(r.label);
    });
    return { fieldId: f.id, requestedM3: requests[i], allocatedM3: x, unmetM3: Math.max(0, requests[i] - x), fulfillment: requests[i] > 0 ? x / requests[i] : 1, sourceRequiredM3, conveyanceLossM3: Math.max(0, sourceRequiredM3 - x), applicationLossM3: Math.max(0, x - rootZoneM3), rootZoneM3, maxGateFlowM3PerHour: routes[i].rate, durationHours: routes[i].rate > 0 ? x / routes[i].rate : 0, bindingConstraints: [...new Set(bindingConstraints)].sort(cmp) };
  });
  const canals: CanalUse[] = edges.map(e => {
    const inletM3 = sum(allocations.map((a, i) => {
      const j = routes[i].path.findIndex(step => step.id === e.id);
      return j < 0 ? 0 : a.allocatedM3 / routes[i].suffix[j];
    }));
    const outletM3 = inletM3 * e.efficiency;
    const capacityM3 = e.closed ? 0 : Math.min(e.volumeLimitM3??Infinity,e.maxFlowM3PerHour * n.windowHours);
    bounded(inletM3, capacityM3, `canal ${e.id}`);
    return { id: e.id, inletM3, outletM3, lossM3: inletM3 - outletM3, capacityM3, closed: e.closed };
  });
  const deliveryOrder = fields.map((_, i) => i).filter(i => allocated[i] > 0).sort((a, b) => {
    const da = demands[a].firstStressDateWithoutIrrigation;
    const db = demands[b].firstStressDateWithoutIrrigation;
    const dateOrder = da === db ? 0 : da === null ? 1 : db === null ? -1 : cmp(da, db);
    return dateOrder || fields[b].priority - fields[a].priority || cmp(fields[a].id, fields[b].id);
  });
  let cursor = 0;
  const schedule: GateSlot[] = deliveryOrder.map(i => {
    const startHour = cursor;
    const requiredDuration = allocations[i].durationHours;
    cursor += requiredDuration;
    // At large start times, a tiny duration can round down or disappear.
    // Round the interval upward, then reduce flow to preserve its exact volume.
    if (cursor - startHour < requiredDuration) cursor += Number.EPSILON * Math.max(1, Math.abs(cursor));
    const actualDuration = cursor - startHour;
    invariant(actualDuration > 0, 'positive delivery interval');
    allocations[i].durationHours = actualDuration;
    const gateFlowM3PerHour = allocations[i].allocatedM3 / actualDuration;
    const sourceFlowM3PerHour = gateFlowM3PerHour / routes[i].efficiency;
    bounded(sourceFlowM3PerHour, n.sourceMaxFlowM3PerHour, 'schedule source flow');
    routes[i].path.forEach((e, j) => bounded(gateFlowM3PerHour / routes[i].suffix[j], e.closed ? 0 : e.maxFlowM3PerHour, `schedule canal ${e.id} flow`));
    return { fieldId: fields[i].id, startHour, endHour: cursor, gateFlowM3PerHour, sourceFlowM3PerHour, gateVolumeM3: allocated[i], sourceVolumeM3: allocations[i].sourceRequiredM3 };
  });
  bounded(cursor, n.windowHours, 'schedule duration');
  const sourceUsedM3 = sum(allocations.map(a => a.sourceRequiredM3));
  const fieldGateM3 = sum(allocated);
  const rootZoneM3 = sum(allocations.map(a => a.rootZoneM3));
  const conveyanceLossM3 = sum(canals.map(c => c.lossM3));
  const applicationLossM3 = sum(allocations.map(a => a.applicationLossM3));
  equal(sourceUsedM3, fieldGateM3 + conveyanceLossM3, 'source mass balance');
  equal(fieldGateM3, rootZoneM3 + applicationLossM3, 'application mass balance');
  equal(conveyanceLossM3, sum(allocations.map(a => a.conveyanceLossM3)), 'canal/field loss agreement');
  equal(sourceUsedM3, usage[0], 'source usage agreement');
  equal(cursor, usage[usage.length - 1], 'gate time agreement');
  for (const node of n.nodes) {
    const incoming = canals.find(c => parent.get(node)?.id === c.id)?.outletM3 ?? 0;
    const outgoing = sum(canals.filter(c => edges.find(e => e.id === c.id)!.from === node).map(c => c.inletM3));
    const local = sum(allocations.filter((_, i) => fields[i].nodeId === node).map(a => a.allocatedM3));
    equal(node === n.sourceId ? sourceUsedM3 : incoming, outgoing + local, `node ${node} mass balance`);
  }
  for (const slot of schedule) {
    equal((slot.endHour - slot.startHour) * slot.gateFlowM3PerHour, slot.gateVolumeM3, `slot ${slot.fieldId} gate volume`);
    equal((slot.endHour - slot.startHour) * slot.sourceFlowM3PerHour, slot.sourceVolumeM3, `slot ${slot.fieldId} source volume`);
  }
  const warnings = [
    'Daily demand assumes timely irrigation within each day. The allocation and gate schedule cover one delivery window and are not matched to daily dates or irrigation deadlines; the no-irrigation stress date is only an early warning.',
    'Serial gate scheduling is conservative. This model does not simulate hydraulic concurrency, travel time, infiltration, runoff dynamics, groundwater, capillary rise, salinity, or yield.'
  ];
  allocations.forEach((a, i) => {
    if (a.unmetM3 > 0) warnings.push(`Field ${a.fieldId}: unmet gate demand ${a.unmetM3} m3.`);
    if (routes[i].blocked.length > 0) warnings.push(`Field ${a.fieldId}: route cannot deliver (${routes[i].blocked.join(', ')}).`);
  });
  return {
    version: 'ariq-irrigation-v1', kind: 'simulation', inputNote: p.inputNote,
    method: 'FAO56 standard-condition ETc and daily depletion volume planning; demand-times-priority weighted max-min progressive filling with source, canal inlet, and serial gate-time constraints.',
    assumptions: [
      'ETc = Kc * ET0 under standard no-stress conditions (FAO56 Eq. 58); supplied Kc values require local agronomic justification and are not calibrated Uzbekistan defaults.',
      'TAW = 1000 * (fieldCapacity - wiltingPoint) * rootDepthM; RAW = depletionFraction * TAW (FAO56 Eqs. 82 and 83). Daily storage uses Eq. 85 with no capillary rise or modeled runoff dynamics.',
      `Rain retention fraction ${p.rainRetentionFraction} is a user scenario assumption, not a measured runoff or infiltration estimate. Excess retained rain drains after daily ET.`,
      'When daily pre-irrigation depletion exceeds RAW, planned net irrigation refills to the supplied target fraction of TAW. The comparison tolerance is 1e-10 * max(1, TAW) mm.',
      'Planned daily irrigation assumes timely application; allocated horizon volumes and the single delivery-window schedule are not matched to demand dates and do not establish that daily deadlines are met.',
      'The separate no-irrigation bucket is clipped to [0, TAW]; its first threshold crossing is an early warning, not a measured moisture state or a yield prediction.',
      'Network topology is a rooted tree with fixed conveyance efficiencies. Net root-zone volume divided by application efficiency determines field-gate demand; 1 mm over 1 hectare equals 10 m3.',
      'Only one field gate operates at a time at its route maximum rate. Available source volume and canal inlet capacities apply across the entire delivery window.',
      'Optional canal volume limits are supplied quotas at the canal inlet, distinct from maximum flow rate. Both quota and flow-derived window capacity are respected.',
      'Supported positive flow rates are at least 0.000001 m3/hour; smaller rates are rejected explicitly to avoid numerical underflow.',
      'Priority weights are user preferences for allocation fairness; they do not establish optimal yield or water savings.',
      'All results are simulation outputs from supplied weather, soil, crop, supply, and network inputs. No farms, canals, real-time observations, or calibrated parameters are inferred.'
    ],
    demands, allocations, canals, schedule,
    totals: { availableM3: n.supplyM3, sourceUsedM3, unusedM3: Math.max(0, n.supplyM3 - sourceUsedM3), fieldGateM3, rootZoneM3, conveyanceLossM3, applicationLossM3, requestedM3: sum(requests), unmetM3: sum(allocations.map(a => a.unmetM3)), scheduledHours: cursor },
    warnings
  };
}

