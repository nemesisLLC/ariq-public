'use client';
/**
 * Tiny context bus + conversation store for the Copilot.
 *
 * FarmJourney / FieldWorkspace publish a SMALL structured snapshot (view,
 * step, crop, planting date, boundary presence, representative coordinate,
 * active tool). The Copilot reads it — no page HTML, no dataset dumps.
 * Conversation lives at module level so the assistant survives the
 * atlas <-> farm-journey tree switch without losing the thread.
 */
export type CopilotContextSnapshot = {
  view: string;
  step?: number;
  cropId?: string;
  plantingDate?: string;
  hasBoundary?: boolean;
  latitude?: number;
  longitude?: number;
  areaHa?: number;
  tool?: string;
  region?: string;
  soilBasis?: string;
  /** Deterministic workflow state — updated locally, never via the paid model. */
  analysisStatus?: 'none' | 'loading' | 'ready' | 'error';
  hasProfile?: boolean;
  placeName?: string;
};

let snapshot: CopilotContextSnapshot = { view: 'atlas' };
const listeners = new Set<() => void>();
export function publishCopilotContext(next: CopilotContextSnapshot) {
  snapshot = next;
  listeners.forEach(l => l());
}
export function readCopilotContext() { return snapshot; }
export function subscribeCopilotContext(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export type ResultCard =
  | { kind: 'waterway'; name: string; type: string; distanceKm?: number; region?: string }
  | { kind: 'demand'; etCropMm?: number; deficitMm?: number; stressDate?: string; missing?: string[] }
  | { kind: 'scenario'; label: string; retainedPct?: number; note?: string };

export type ChatTurn = { role: 'user' | 'assistant'; text: string; title?: string; caveats?: string[]; tools?: string[]; unavailable?: boolean; cards?: ResultCard[]; actions?: { type: string; latitude?: number; longitude?: number; features?: { id: string; coordinates: [number, number] }[] }[]; ctx?: string };
export const conversationStore: { turns: ChatTurn[] } = { turns: [] };
/** Panel open state also survives the atlas <-> journey remount. */
export const copilotUiStore: { open: boolean } = { open: false };
