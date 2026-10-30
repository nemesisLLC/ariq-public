/**
 * Pure budget ledger core, shared by the Durable Object (production,
 * SQLite-backed, atomic because a DO is single-threaded) and by tests.
 * All amounts are micro-USD integers. Reserve-before-call, reconcile after:
 * a reservation holds the conservative maximum; reconciliation replaces it
 * with the actual cost computed from provider token usage.
 */
export type BudgetState = { totalSpentMicroUsd: number; day: string; daySpentMicroUsd: number; reservations: Record<string, number> };
export type BudgetCaps = { totalMicroUsd: number; dailyMicroUsd: number };

export function emptyBudget(day: string): BudgetState {
  return { totalSpentMicroUsd: 0, day, daySpentMicroUsd: 0, reservations: {} };
}

function rollDay(state: BudgetState, day: string): BudgetState {
  return state.day === day ? state : { ...state, day, daySpentMicroUsd: 0 };
}

export function budgetReserve(state: BudgetState, caps: BudgetCaps, id: string, amountMicroUsd: number, day: string): { state: BudgetState; ok: boolean; reason?: string } {
  const s = rollDay(state, day);
  if (amountMicroUsd <= 0) return { state: s, ok: false, reason: 'invalid-reservation' };
  if (s.reservations[id] !== undefined) return { state: s, ok: true }; // idempotent replay
  if (s.totalSpentMicroUsd + amountMicroUsd > caps.totalMicroUsd) return { state: s, ok: false, reason: 'total-budget-exhausted' };
  if (s.daySpentMicroUsd + amountMicroUsd > caps.dailyMicroUsd) return { state: s, ok: false, reason: 'daily-budget-exhausted' };
  return { state: { ...s, totalSpentMicroUsd: s.totalSpentMicroUsd + amountMicroUsd, daySpentMicroUsd: s.daySpentMicroUsd + amountMicroUsd, reservations: { ...s.reservations, [id]: amountMicroUsd } }, ok: true };
}

export function budgetReconcile(state: BudgetState, id: string, actualMicroUsd: number): BudgetState {
  const reserved = state.reservations[id];
  if (reserved === undefined) return state;
  const delta = Math.max(0, Math.round(actualMicroUsd)) - reserved;
  const reservations = { ...state.reservations };
  delete reservations[id];
  return { ...state, totalSpentMicroUsd: Math.max(0, state.totalSpentMicroUsd + delta), daySpentMicroUsd: Math.max(0, state.daySpentMicroUsd + delta), reservations };
}

export function budgetStatus(state: BudgetState, caps: BudgetCaps, day: string) {
  const s = rollDay(state, day);
  return {
    totalSpentMicroUsd: s.totalSpentMicroUsd, totalCapMicroUsd: caps.totalMicroUsd,
    daySpentMicroUsd: s.daySpentMicroUsd, dailyCapMicroUsd: caps.dailyMicroUsd,
    remainingMicroUsd: Math.max(0, Math.min(caps.totalMicroUsd - s.totalSpentMicroUsd, caps.dailyMicroUsd - s.daySpentMicroUsd)),
    openReservations: Object.keys(s.reservations).length,
  };
}
