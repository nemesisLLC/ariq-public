import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFieldDemand, calculatePlan, InputError } from '../lib/irrigation/core.ts';
import type { FieldInput, PlanInput, PlanResult, WeatherDay } from '../lib/irrigation/core.ts';

function near(actual: number, expected: number, relative = 1e-9): void {
  assert.ok(Number.isFinite(actual), `non-finite result: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function field(id = 'a', changes: Partial<FieldInput> = {}): FieldInput {
  return { id, nodeId: id, areaHa: 1, kc: 1, applicationEfficiency: 1, priority: 1,
    soil: { fieldCapacity: 0.3, wiltingPoint: 0.1, rootDepthM: 0.5, depletionFraction: 0.5, initialDepletionMm: 50, targetDepletionFraction: 0.2 }, ...changes };
}
const weather: WeatherDay[] = [{ date: '2026-06-01', et0Mm: 10, rainMm: 0 }];
function plan(ids = ['a', 'b']): PlanInput {
  return { kind: 'simulation', inputNote: 'Synthetic soil, crop, rainfall retention and network assumptions.', rainRetentionFraction: 1,
    weather: structuredClone(weather), fields: ids.map(id => field(id)),
    network: { sourceId: 's', nodes: ['s', ...ids], supplyM3: 10000, sourceMaxFlowM3PerHour: 10000, windowHours: 10,
      edges: ids.map(id => ({ id: `e_${id}`, from: 's', to: id, maxFlowM3PerHour: 10000, efficiency: 1, closed: false })) } };
}
function allocation(result: PlanResult, id: string) {
  const value = result.allocations.find(a => a.fieldId === id);
  assert.ok(value);
  return value;
}
function checkBalances(result: PlanResult, p: PlanInput): void {
  const t = result.totals;
  near(t.sourceUsedM3 + t.unusedM3, t.availableM3);
  near(t.sourceUsedM3, t.fieldGateM3 + t.conveyanceLossM3);
  near(t.fieldGateM3, t.rootZoneM3 + t.applicationLossM3);
  near(t.requestedM3, t.fieldGateM3 + t.unmetM3);
  near(result.canals.reduce((v, c) => v + c.lossM3, 0), t.conveyanceLossM3);
  assert.ok(t.sourceUsedM3 <= p.network.supplyM3 + 1e-9 * Math.max(1, p.network.supplyM3));
  assert.ok(t.scheduledHours <= p.network.windowHours + 1e-9 * Math.max(1, p.network.windowHours));
  const byId = new Map(p.network.edges.map(e => [e.id, e]));
  for (const c of result.canals) {
    near(c.inletM3, c.outletM3 + c.lossM3);
    near(c.outletM3, c.inletM3 * byId.get(c.id)!.efficiency);
    assert.ok(c.inletM3 >= 0 && c.inletM3 <= c.capacityM3 + 1e-9 * Math.max(1, c.capacityM3));
    if (c.closed) near(c.inletM3, 0);
  }
  let end = 0;
  const parent = new Map(p.network.edges.map(e => [e.to, e]));
  for (const slot of result.schedule) {
    near(slot.startHour, end);
    assert.ok(slot.endHour >= slot.startHour);
    assert.ok(slot.sourceFlowM3PerHour <= p.network.sourceMaxFlowM3PerHour + 1e-8);
    near((slot.endHour - slot.startHour) * slot.gateFlowM3PerHour, slot.gateVolumeM3);
    near((slot.endHour - slot.startHour) * slot.sourceFlowM3PerHour, slot.sourceVolumeM3);
    const f = p.fields.find(f => f.id === slot.fieldId)!;
    let node = f.nodeId;
    let downstreamEfficiency = 1;
    while (node !== p.network.sourceId) {
      const e = parent.get(node)!;
      downstreamEfficiency *= e.efficiency;
      assert.ok(!e.closed);
      assert.ok(slot.gateFlowM3PerHour / downstreamEfficiency <= e.maxFlowM3PerHour + 1e-8);
      node = e.from;
    }
    end = slot.endHour;
  }
  near(end, t.scheduledHours);
  near(result.schedule.reduce((v, s) => v + s.sourceVolumeM3, 0), t.sourceUsedM3);
  for (const a of result.allocations) {
    assert.ok(a.allocatedM3 >= 0 && a.allocatedM3 <= a.requestedM3 + 1e-8);
    near(a.allocatedM3 + a.unmetM3, a.requestedM3);
    near(a.sourceRequiredM3, a.allocatedM3 + a.conveyanceLossM3);
    near(a.allocatedM3, a.rootZoneM3 + a.applicationLossM3);
    assert.ok(a.fulfillment >= 0 && a.fulfillment <= 1);
  }
}

test('FAO storage, standard ET and hectare conversion have hand-calculated values', () => {
  const f = field('a', { areaHa: 2, kc: 1.2, applicationEfficiency: 0.8 });
  f.soil = { fieldCapacity: 0.3, wiltingPoint: 0.1, rootDepthM: 0.5, depletionFraction: 0.5, initialDepletionMm: 45, targetDepletionFraction: 0.2 };
  const d = calculateFieldDemand(f, [{ date: '2026-06-01', et0Mm: 10, rainMm: 0 }], 1);
  // TAW=100, RAW=50, ETc=12, pre=57, target=20, net=37.
  near(d.totalAvailableMm, 100);
  near(d.readilyAvailableMm, 50);
  near(d.daily[0].etCropMm, 12);
  near(d.netIrrigationMm, 37);
  near(d.grossDemandM3, 925);
  near(d.daily[0].endDepletionMm, 20);
  assert.equal(d.firstStressDateWithoutIrrigation, '2026-06-01');
});

test('retained rainfall reduces demand and heavy rain drains after ET', () => {
  const f = field();
  const dry = calculateFieldDemand(f, weather, 1);
  const wet = calculateFieldDemand(f, [{ ...weather[0], rainMm: 8 }], 0.5);
  near(dry.netIrrigationMm, 40);
  near(wet.netIrrigationMm, 36);
  const heavy = calculateFieldDemand(f, [{ ...weather[0], rainMm: 100 }], 1);
  near(heavy.daily[0].drainageMm, 40);
  near(heavy.daily[0].endDepletionMm, 0);
  near(heavy.grossDemandM3, 0);
  assert.equal(heavy.firstStressDateWithoutIrrigation, null);
});

test('strict threshold, timely refill, and separate no-irrigation warning', () => {
  const f = field();
  f.soil.initialDepletionMm = 40;
  const d = calculateFieldDemand(f, [
    { date: '2028-02-28', et0Mm: 10, rainMm: 0 },
    { date: '2028-02-29', et0Mm: 10, rainMm: 0 },
    { date: '2028-03-01', et0Mm: 10, rainMm: 0 }
  ], 1);
  near(d.daily[0].netIrrigationMm, 0);
  near(d.daily[1].netIrrigationMm, 40);
  near(d.daily[1].endDepletionMm, 20);
  near(d.daily[2].endDepletionMm, 30);
  assert.equal(d.firstStressDateWithoutIrrigation, '2028-02-29');
});

test('zero net demand is fulfilled with no gate slot', () => {
  const p = plan(['a']);
  p.fields[0].kc = 0;
  const r = calculatePlan(p);
  near(r.totals.requestedM3, 0);
  near(allocation(r, 'a').fulfillment, 1);
  assert.deepEqual(r.schedule, []);
  checkBalances(r, p);
});

test('full supply is capped at demand and leaves unused volume', () => {
  const p = plan();
  const r = calculatePlan(p);
  near(r.totals.requestedM3, 800);
  near(r.totals.fieldGateM3, 800);
  near(r.totals.unusedM3, 9200);
  assert.ok(r.allocations.every(a => a.bindingConstraints.includes('demand-met')));
  checkBalances(r, p);
});

test('supply shortage equalizes fulfillment; weights encode priority', () => {
  const p = plan();
  p.fields[1].areaHa = 2;
  p.network.supplyM3 = 300;
  let r = calculatePlan(p);
  near(allocation(r, 'a').allocatedM3, 100);
  near(allocation(r, 'b').allocatedM3, 200);
  near(allocation(r, 'a').fulfillment, allocation(r, 'b').fulfillment);
  p.fields[1].areaHa = 1;
  p.fields[1].priority = 2;
  r = calculatePlan(p);
  near(allocation(r, 'a').allocatedM3, 100);
  near(allocation(r, 'b').allocatedM3, 200);
  assert.ok(r.allocations.every(a => a.bindingConstraints.includes('source-supply')));
  assert.equal(r.schedule[0].fieldId, 'b');
  checkBalances(r, p);
});

test('demand-capped field leaves the remaining supply to other active fields', () => {
  const p = plan();
  p.fields[0].areaHa = 0.1;
  p.fields[0].priority = 10;
  p.network.supplyM3 = 200;
  const r = calculatePlan(p);
  near(allocation(r, 'a').allocatedM3, 40);
  near(allocation(r, 'b').allocatedM3, 160);
  checkBalances(r, p);
});

test('two lossy canals account for inlet capacities and both kinds of loss', () => {
  const p = plan(['a']);
  p.fields[0].applicationEfficiency = 0.8;
  p.network.nodes.push('j');
  p.network.sourceMaxFlowM3PerHour = 100;
  p.network.windowHours = 20;
  p.network.edges = [
    { id: 'up', from: 's', to: 'j', maxFlowM3PerHour: 80, efficiency: 0.8, closed: false },
    { id: 'down', from: 'j', to: 'a', maxFlowM3PerHour: 100, efficiency: 0.5, closed: false }
  ];
  const r = calculatePlan(p);
  const a = allocation(r, 'a');
  near(a.requestedM3, 500);
  near(a.allocatedM3, 500);
  near(a.sourceRequiredM3, 1250);
  near(a.conveyanceLossM3, 750);
  near(a.rootZoneM3, 400);
  near(a.applicationLossM3, 100);
  near(a.maxGateFlowM3PerHour, 32);
  near(a.durationHours, 15.625);
  near(r.canals.find(c => c.id === 'up')!.inletM3, 1250);
  near(r.canals.find(c => c.id === 'down')!.inletM3, 1000);
  checkBalances(r, p);
});

test('shared volume quota freezes its branch while unrelated branch keeps filling', () => {
  const p = plan(['a', 'b', 'c']);
  p.network.nodes.push('j');
  p.network.edges[0].from = 'j';
  p.network.edges[1].from = 'j';
  p.network.edges.push({ id: 'shared', from: 's', to: 'j', maxFlowM3PerHour: 2000, volumeLimitM3:200, efficiency: 1, closed: false });
  const r = calculatePlan(p);
  near(allocation(r, 'a').allocatedM3, 100);
  near(allocation(r, 'b').allocatedM3, 100);
  near(allocation(r, 'c').allocatedM3, 400);
  assert.ok(allocation(r, 'a').bindingConstraints.includes('canal:shared'));
  assert.ok(!allocation(r, 'c').bindingConstraints.includes('canal:shared'));
  checkBalances(r, p);
});

test('closed and zero-rate routes leave unrelated fields deliverable', () => {
  for (const mode of ['closed', 'zero-rate']) {
    const p = plan();
    if (mode === 'closed') p.network.edges[0].closed = true;
    else p.network.edges[0].maxFlowM3PerHour = 0;
    const r = calculatePlan(p);
    near(allocation(r, 'a').allocatedM3, 0);
    near(allocation(r, 'a').maxGateFlowM3PerHour, 0);
    near(allocation(r, 'b').allocatedM3, 400);
    assert.ok(r.warnings.some(w => w.includes('route cannot deliver')));
    checkBalances(r, p);
  }
});

test('zero source supply or rate produces finite zero delivery', () => {
  for (const property of ['supplyM3', 'sourceMaxFlowM3PerHour'] as const) {
    const p = plan();
    p.network[property] = 0;
    const r = calculatePlan(p);
    near(r.totals.sourceUsedM3, 0);
    near(r.totals.unmetM3, 800);
    assert.equal(r.schedule.length, 0);
    checkBalances(r, p);
  }
});

test('serial gate time is a shared constraint even across independent branches', () => {
  const p = plan();
  p.network.windowHours = 1;
  p.network.edges.forEach(e => { e.maxFlowM3PerHour = 100; });
  const r = calculatePlan(p);
  near(allocation(r, 'a').allocatedM3, 50);
  near(allocation(r, 'b').allocatedM3, 50);
  near(r.totals.scheduledHours, 1);
  near(r.schedule[0].endHour, 0.5);
  near(r.schedule[1].startHour, 0.5);
  assert.ok(r.allocations.every(a => a.bindingConstraints.includes('gate-window')));
  checkBalances(r, p);
});

test('source-node field needs no canal and still consumes source flow and gate time', () => {
  const p = plan(['a']);
  p.fields[0].nodeId = 's';
  p.network.nodes = ['s'];
  p.network.edges = [];
  p.network.sourceMaxFlowM3PerHour = 100;
  p.network.windowHours = 2;
  const r = calculatePlan(p);
  near(allocation(r, 'a').allocatedM3, 200);
  near(allocation(r, 'a').conveyanceLossM3, 0);
  near(r.totals.scheduledHours, 2);
  checkBalances(r, p);
});

test('output is invariant to input array order, does not mutate or echo unknown properties', () => {
  const p = plan(['c', 'a', 'b']);
  p.network.supplyM3 = 450;
  const before = structuredClone(p);
  const r = calculatePlan({ ...p, privateExtra: 'not-to-be-returned' });
  assert.deepEqual(p, before);
  p.fields.reverse();
  p.network.nodes.reverse();
  p.network.edges.reverse();
  assert.deepEqual(calculatePlan(p), r);
  assert.ok(!JSON.stringify(r).includes('not-to-be-returned'));
});

test('stress warning precedes priority when ordering the volume schedule', () => {
  const p = plan();
  p.fields[1].priority = 10;
  p.fields[1].soil.initialDepletionMm = 40;
  p.weather.push({ date: '2026-06-02', et0Mm: 10, rainMm: 0 });
  const r = calculatePlan(p);
  assert.equal(r.schedule[0].fieldId, 'a');
  assert.ok(r.assumptions.some(a => a.includes('not matched to demand dates')));
  checkBalances(r, p);
});

test('runtime validation rejects malformed inputs without trusting TypeScript', () => {
  const cases: unknown[] = [null, [], 5, 'simulation', {}, { ...plan(), kind: 'live' }, { ...plan(), fields: [] }, { ...plan(), weather: [] }];
  const mutations: Array<(p: PlanInput) => void> = [
    p => { (p as unknown as Record<string, unknown>).rainRetentionFraction = '1'; },
    p => { p.inputNote = ' '; },
    p => { p.inputNote = 'x'.repeat(501); },
    p => { p.weather[0].et0Mm = NaN; },
    p => { p.weather[0].rainMm = Infinity; },
    p => { p.fields[0].areaHa = 0; },
    p => { p.fields[0].kc = 2.6; },
    p => { p.fields[0].applicationEfficiency = 0; },
    p => { p.fields[0].priority = 0; },
    p => { p.fields[0].soil.fieldCapacity = p.fields[0].soil.wiltingPoint; },
    p => { p.fields[0].soil.initialDepletionMm = 101; },
    p => { p.fields[0].soil.targetDepletionFraction = 0.6; },
    p => { p.fields[0].soil.rootDepthM = 0.01; },
    p => { p.network.windowHours = 0; },
    p => { p.network.supplyM3 = 1e10; },
    p => { p.network.edges[0].efficiency = 0; },
    p => { (p.network.edges[0] as unknown as Record<string, unknown>).closed = 'false'; },
    p => { p.network.sourceMaxFlowM3PerHour = -1; },
    p => { p.fields[0].id = '../bad'; },
    p => { p.fields[0].id = 'a'.repeat(65); },
    p => { p.fields[1].id = p.fields[0].id; },
    p => { p.fields[1].nodeId = p.fields[0].nodeId; },
    p => { p.network.nodes.push('a'); },
    p => { p.network.edges[1].id = p.network.edges[0].id; },
    p => { p.fields = Array.from({ length: 101 }, (_, i) => field(`f${i}`)); },
    p => { p.network.nodes = Array.from({ length: 201 }, (_, i) => `n${i}`); },
    p => { p.network.edges = Array.from({ length: 201 }, (_, i) => ({ ...p.network.edges[0], id: `e${i}` })); },
    p => { p.weather = Array.from({ length: 15 }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, et0Mm: 1, rainMm: 0 })); }
  ];
  for (const mutate of mutations) { const p = plan(); mutate(p); cases.push(p); }
  for (const value of cases) assert.throws(() => calculatePlan(value), InputError);
  assert.throws(() => calculateFieldDemand(null as unknown as FieldInput, weather, 1), InputError);
  assert.throws(() => calculateFieldDemand(field(), null as unknown as WeatherDay[], 1), InputError);
  assert.throws(() => calculateFieldDemand(field(), weather, '1' as unknown as number), InputError);
});

test('calendar validation rejects normalized dates, malformed dates and missing days', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '2026-6-01', '2026-06-01T00:00:00Z']) {
    const p = plan(); p.weather[0].date = date;
    assert.throws(() => calculatePlan(p), InputError, date);
  }
  for (const date of ['2026-06-01', '2026-06-03', '2026-05-31']) {
    const p = plan(); p.weather.push({ date, et0Mm: 1, rainMm: 0 });
    assert.throws(() => calculatePlan(p), /consecutive/);
  }
});

test('tree validation checks cycles even when disconnected, parents and reachability', () => {
  const mutations: Array<(p: PlanInput) => void> = [
    p => { p.network.edges[0].to = 'missing'; },
    p => { p.network.edges[0].to = 's'; },
    p => { p.network.edges.push({ ...p.network.edges[0], id: 'duplicate_parent' }); },
    p => { p.network.nodes.push('orphan'); },
    p => { p.fields[0].nodeId = 'missing'; },
    p => { p.network.sourceId = 'missing'; },
    p => { p.network.nodes.push('x', 'y'); p.network.edges.push(
      { id: 'xy', from: 'x', to: 'y', maxFlowM3PerHour: 1, efficiency: 1, closed: false },
      { id: 'yx', from: 'y', to: 'x', maxFlowM3PerHour: 1, efficiency: 1, closed: false }); },
    p => { p.network.nodes.push('x'); p.network.edges.push({ id: 'self', from: 'x', to: 'x', maxFlowM3PerHour: 1, efficiency: 1, closed: false }); }
  ];
  for (const mutate of mutations) { const p = plan(); mutate(p); assert.throws(() => calculatePlan(p), InputError); }
});

test('excessively lossy paths are rejected even when closed or without fields', () => {
  const p = plan(['a']);
  let from = 's';
  for (let i = 0; i < 7; i++) {
    const to = `loss${i}`;
    p.network.nodes.push(to);
    p.network.edges.push({ id: `loss_edge${i}`, from, to, maxFlowM3PerHour: 1, efficiency: 0.05, closed: true });
    from = to;
  }
  assert.throws(() => calculatePlan(p), /path efficiency/);
});

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

test('deterministic randomized trees respect capacity, scheduling and conservation', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const rnd = random(seed);
    const count = 2 + Math.floor(rnd() * 12);
    const ids = Array.from({ length: count }, (_, i) => `f${i}`);
    const p = plan(ids);
    p.network.nodes.push('j0', 'j1');
    p.network.supplyM3 = seed % 11 === 0 ? 0 : 50 + rnd() * 20000;
    p.network.sourceMaxFlowM3PerHour = seed % 13 === 0 ? 0 : 20 + rnd() * 3000;
    p.network.windowHours = 0.01 + rnd() * 24;
    p.network.edges.push(
      { id: 'trunk0', from: 's', to: 'j0', maxFlowM3PerHour: 10 + rnd() * 1500, efficiency: 0.5 + rnd() * 0.5, closed: seed % 17 === 0 },
      { id: 'trunk1', from: 'j0', to: 'j1', maxFlowM3PerHour: 10 + rnd() * 1000, efficiency: 0.5 + rnd() * 0.5, closed: false });
    p.network.edges.slice(0, count).forEach((e, i) => {
      e.from = ['s', 'j0', 'j1'][i % 3];
      e.efficiency = 0.2 + rnd() * 0.8;
      e.maxFlowM3PerHour = seed % 7 === 0 && i === 0 ? 0 : 5 + rnd() * 700;
      e.closed = rnd() < 0.1;
    });
    p.fields.forEach(f => {
      f.areaHa = 0.01 + rnd() * 10;
      f.priority = 0.1 + rnd() * 9.9;
      f.applicationEfficiency = 0.05 + rnd() * 0.95;
      f.kc = rnd() * 2.5;
      f.soil.initialDepletionMm = rnd() * 100;
      f.soil.targetDepletionFraction = rnd() * 0.5;
    });
    p.rainRetentionFraction = rnd();
    p.weather = Array.from({ length: 7 }, (_, i) => ({ date: `2026-06-0${i + 1}`, et0Mm: rnd() * 20, rainMm: rnd() * 25 }));
    const r = calculatePlan(p);
    checkBalances(r, p);
    const reversed = structuredClone(p);
    reversed.fields.reverse(); reversed.network.nodes.reverse(); reversed.network.edges.reverse();
    assert.deepEqual(calculatePlan(reversed), r, `order invariance seed ${seed}`);
  }
});

