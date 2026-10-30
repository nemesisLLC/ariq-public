import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSchedule, kcForDay, penmanMonteithDetails, penmanMonteithET0, stressCoefficient,
  type ScheduleInput,
} from '../lib/irrigation/scheduler.ts';
import { calculatePlan, type PlanInput } from '../lib/irrigation/core.ts';
import { allocate } from '../lib/planner.ts';

function near(actual: number, expected: number, tol = 1e-6): void {
  assert.ok(Number.isFinite(actual), `non-finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
const soil = { fieldCapacity: 0.3, wiltingPoint: 0.1, rootDepthM: 0.5, depletionFraction: 0.5, initialDepletionMm: 50, targetDepletionFraction: 0.2 };
function days(n: number, et0 = 10, rain = 0) {
  return Array.from({ length: n }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, et0Mm: et0, rainMm: rain }));
}
function input(changes: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    kind: 'simulation', inputNote: 'Synthetic advanced-scheduler fixture; not a measured farm.',
    rainRetentionFraction: 1, weather: days(5),
    fields: [{ id: 'a', nodeId: 'a', areaHa: 1, kc: 1, applicationEfficiency: 1, priority: 1, soil: structuredClone(soil) }],
    network: { sourceId: 's', nodes: ['s', 'a'], supplyM3: 100000, sourceMaxFlowM3PerHour: 1000, windowHoursPerDay: 10,
      edges: [{ id: 'e_a', from: 's', to: 'a', maxFlowM3PerHour: 1000, efficiency: 1, closed: false }] },
    ...changes,
  };
}
function twoFields(supply = 100000): ScheduleInput {
  const p = input();
  p.fields.push({ id: 'b', nodeId: 'b', areaHa: 1, kc: 1, applicationEfficiency: 1, priority: 1, soil: structuredClone(soil) });
  p.network.nodes.push('b');
  p.network.edges.push({ id: 'e_b', from: 's', to: 'b', maxFlowM3PerHour: 1000, efficiency: 1, closed: false });
  p.network.supplyM3 = supply;
  return p;
}

// --- FAO-56 Penman-Monteith (Eq. 6 and supporting equations) ---
test('Penman-Monteith components match FAO-56 tabulated values', () => {
  const d = penmanMonteithDetails({ date: '2026-07-06', tmaxC: 30, tminC: 20, rhMaxPct: 80, rhMinPct: 40, windMPerS: 2, solarRadiationMJm2Day: 20, latitudeDeg: 40, elevationM: 200 });
  // FAO-56 Annex 2: e°(25°C)=3.17 kPa, slope at 25°C ~0.189 kPa/°C.
  near(d.meanSaturationVapourPressureKpa, (4.243 + 2.338) / 2, 0.02);
  near(d.slopeVapourPressureKpaPerC, 0.189, 0.02);
  near(d.atmosphericPressureKpa, 98.96, 0.01);
  assert.ok(d.et0MmPerDay > 3 && d.et0MmPerDay < 8, `plausible daily ET0, got ${d.et0MmPerDay}`);
  near(penmanMonteithET0({ date: '2026-07-06', tmaxC: 30, tminC: 20, rhMaxPct: 80, rhMinPct: 40, windMPerS: 2, solarRadiationMJm2Day: 20, latitudeDeg: 40, elevationM: 200 }), d.et0MmPerDay);
});
test('Penman-Monteith is deterministic, rises with radiation/wind, falls with humidity', () => {
  const base = { date: '2026-07-06', tmaxC: 30, tminC: 20, windMPerS: 2, solarRadiationMJm2Day: 20, latitudeDeg: 40, elevationM: 200 };
  const dry = penmanMonteithET0({ ...base, rhMaxPct: 60, rhMinPct: 20 });
  assert.equal(penmanMonteithET0({ ...base, rhMaxPct: 60, rhMinPct: 20 }), dry);
  assert.ok(penmanMonteithET0({ ...base, rhMaxPct: 100, rhMinPct: 90 }) < dry);
  assert.ok(penmanMonteithET0({ ...base, rhMaxPct: 60, rhMinPct: 20, solarRadiationMJm2Day: 25 }) > dry);
  assert.ok(penmanMonteithET0({ ...base, rhMaxPct: 60, rhMinPct: 20, dewpointC: 10 }) > 0);
});
test('stress coefficient follows FAO-56 Eq. 84', () => {
  near(stressCoefficient(40, 100, 50), 1);
  near(stressCoefficient(50, 100, 50), 1);
  near(stressCoefficient(75, 100, 50), 0.5);
  near(stressCoefficient(100, 100, 50), 0);
  near(stressCoefficient(120, 100, 50), 0);
});
test('Kc curve interpolates development and late-season stages (FAO-56 Ch. 6)', () => {
  const curve = { kcIni: 0.3, kcMid: 1.2, kcEnd: 0.6, stageLengthsDays: { initial: 10, development: 10, mid: 10, late: 10 } };
  near(kcForDay(curve, 0), 0.3); near(kcForDay(curve, 9), 0.3);
  near(kcForDay(curve, 14), 0.3 + 0.9 * (5 / 10), 1e-9);
  near(kcForDay(curve, 25), 1.2);
  near(kcForDay(curve, 34), 1.2 - 0.6 * (5 / 10), 1e-9);
  near(kcForDay(curve, 100), 0.6);
});

// --- Daily balance, stress tracking, deadlines ---
test('drought: depletion crosses RAW, Ks falls, stress date and deadline event are produced', () => {
  const r = calculateSchedule(input());
  const f = r.fields[0];
  assert.equal(f.firstStressDateWithoutIrrigation, '2026-06-01');
  assert.ok(f.dailyNoIrrigation.some(d => d.ks < 1));
  assert.ok(r.events.length >= 1);
  assert.ok(r.events.every(e => e.deadlineDate <= '2026-06-05'));
  // Every delivery happens on or before its event deadline.
  for (const d of r.deliveries) {
    const e = r.events.find(x => x.eventId === d.eventId)!;
    assert.ok(d.date <= e.deadlineDate, `${d.date} after deadline ${e.deadlineDate}`);
  }
  assert.equal(r.kind, 'simulation');
});
test('rainfall: heavy rain removes the irrigation event and drains excess', () => {
  const p = input(); p.weather = days(5, 10, 100);
  const r = calculateSchedule(p);
  assert.equal(r.events.length, 0);
  assert.ok(r.fields[0].dailyScheduled[0].drainageMm > 0);
  near(r.totals.grossDemandM3, 0);
});
test('scheduled irrigation before the deadline prevents predicted stress in the scheduled trajectory', () => {
  const r = calculateSchedule(input());
  assert.ok(r.fields[0].dailyNoIrrigation.filter(d => d.stress).length > 0);
  assert.equal(r.totals.stressDaysScheduled, 0);
  assert.ok(r.deliveries.length >= 1);
});
test('ET0 can be computed from meteorology instead of being supplied', () => {
  const p = input();
  p.station = { latitudeDeg: 39.65, elevationM: 700 };
  p.weather = days(3).map(d => ({ date: d.date, rainMm: 0, met: { tmaxC: 32, tminC: 18, rhMaxPct: 70, rhMinPct: 30, windMPerS: 2, solarRadiationMJm2Day: 24 } }));
  const r = calculateSchedule(p);
  assert.ok(r.fields[0].dailyScheduled.every(d => d.et0Mm > 2 && d.et0Mm < 10));
});

// --- Physical constraints ---
test('canal closure on the only feasible days makes the schedule impossible and explains why', () => {
  const p = input();
  p.network.edges[0].closedDates = days(5).map(d => d.date);
  const r = calculateSchedule(p);
  assert.ok(r.events.length >= 1);
  assert.ok(r.events.every(e => e.status === 'impossible-before-deadline'));
  assert.ok(r.events[0].bindingConstraints.some(c => c.startsWith('canal-closure')));
  near(r.totals.allocatedGateM3, 0);
});
test('permanent canal closure blocks only its own field', () => {
  const p = twoFields(); p.network.edges[0].closed = true;
  const r = calculateSchedule(p);
  near(r.events.filter(e => e.fieldId === 'a').reduce((s, e) => s + e.allocatedM3, 0), 0);
  assert.ok(r.events.filter(e => e.fieldId === 'b').every(e => e.allocatedM3 > 0));
});
test('insufficient supply: unmet demand is reported with source-supply as binding constraint', () => {
  const p = twoFields(100);
  const r = calculateSchedule(p);
  assert.ok(r.totals.unmetGateM3 > 0);
  assert.ok(r.totals.sourceUsedM3 <= 100 + 1e-6);
  assert.ok(r.events.some(e => e.bindingConstraints.includes('source-supply')));
});
test('delivery window: tiny daily window cannot meet the deadline (impossible schedule)', () => {
  const p = input(); p.network.windowHoursPerDay = 0.1; p.network.sourceMaxFlowM3PerHour = 10; p.network.edges[0].maxFlowM3PerHour = 10;
  const r = calculateSchedule(p);
  assert.ok(r.totals.unmetGateM3 > 0);
  assert.ok(r.events.some(e => e.bindingConstraints.includes('gate-window-before-deadline') || e.bindingConstraints.some(c => c.startsWith('canal-capacity'))));
  for (const d of r.deliveries) assert.ok(d.durationHours <= 0.1 + 1e-9);
});
test('competing priorities: same deadline, higher priority is served first under scarcity', () => {
  const p = twoFields();
  p.fields[1].priority = 5;
  // One day of gate time can serve only one field fully.
  p.network.windowHoursPerDay = 4; p.network.sourceMaxFlowM3PerHour = 100; p.network.edges.forEach(e => { e.maxFlowM3PerHour = 100; });
  p.weather = days(2);
  const r = calculateSchedule(p);
  const a = r.fields.find(f => f.fieldId === 'a')!, b = r.fields.find(f => f.fieldId === 'b')!;
  assert.ok(b.allocatedGateM3 >= a.allocatedGateM3, `priority field should not lose: a=${a.allocatedGateM3} b=${b.allocatedGateM3}`);
});
test('losses: conveyance and application losses are accounted and never negative', () => {
  const p = input();
  p.fields[0].applicationEfficiency = 0.7;
  p.network.edges[0].efficiency = 0.8;
  const r = calculateSchedule(p);
  assert.ok(r.totals.conveyanceLossM3 > 0 && r.totals.applicationLossM3 > 0);
  near(r.totals.sourceUsedM3, r.totals.allocatedGateM3 + r.totals.conveyanceLossM3);
  near(r.totals.allocatedGateM3, r.totals.rootZoneDeliveredM3 + r.totals.applicationLossM3);
});
test('determinism and order invariance', () => {
  const p = twoFields(500);
  const r = calculateSchedule(p);
  assert.deepEqual(calculateSchedule(structuredClone(p)), r);
  const q = structuredClone(p); q.fields.reverse(); q.network.edges.reverse(); q.network.nodes.reverse();
  assert.deepEqual(calculateSchedule(q), r);
});
test('validation rejects measured-kind claims and malformed inputs', () => {
  assert.throws(() => calculateSchedule({ ...input(), kind: 'measured' }));
  assert.throws(() => calculateSchedule({ ...input(), weather: [] }));
  const p = input(); (p.fields[0] as unknown as Record<string, unknown>).kc = 9;
  assert.throws(() => calculateSchedule(p));
  const q = input(); q.network.edges[0].closedDates = ['2026-12-31'];
  assert.throws(() => calculateSchedule(q));
});

// --- Reproducible comparison against the existing implementations (no savings claim) ---
test('comparison: legacy allocate() ignores deadlines/losses; v1 plan warns deadlines are unchecked; v2 enforces them', () => {
  // Legacy allocator: pure volume split, no soil, canal, loss or deadline concept.
  const legacy = allocate([{ id: 1, need: 400, priority: 1 }, { id: 2, need: 400, priority: 1 }], 400);
  near(legacy[1] + legacy[2], 400);
  // v1 volume plan on the equivalent scenario explicitly warns it is not deadline-checked.
  const v1: PlanInput = { kind: 'simulation', inputNote: 'comparison fixture', rainRetentionFraction: 1, weather: days(1),
    fields: [{ id: 'a', nodeId: 'a', areaHa: 1, kc: 1, applicationEfficiency: 1, priority: 1, soil: structuredClone(soil) }],
    network: { sourceId: 's', nodes: ['s', 'a'], supplyM3: 100000, sourceMaxFlowM3PerHour: 1000, windowHours: 10, edges: [{ id: 'e_a', from: 's', to: 'a', maxFlowM3PerHour: 1000, efficiency: 1, closed: false }] } };
  const v1r = calculatePlan(v1);
  assert.ok(v1r.warnings.some(w => w.includes('not matched to daily dates')));
  // v2 on a 5-day drought horizon: all deliveries on/before deadlines, zero scheduled stress when feasible.
  const v2 = calculateSchedule(input());
  assert.equal(v2.totals.stressDaysScheduled, 0);
  assert.ok(v2.events.every(e => e.status === 'scheduled'));
});
