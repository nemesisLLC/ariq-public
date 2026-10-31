export type UiState = { x: number; y: number; w: number; h: number; dock: 'none' | 'left' | 'right'; minimized: boolean };

export function fitWindow(value: unknown, width: number, height: number): UiState {
  const saved = value && typeof value === 'object' ? value as Partial<UiState> : {};
  const finite = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const w = Math.min(Math.max(320, finite(saved.w, 392)), 680, Math.max(1, width - 16));
  const h = Math.min(Math.max(360, finite(saved.h, 560)), 760, Math.max(1, height - 16));
  return {
    x: Math.max(8, Math.min(finite(saved.x, 24), width - w - 8)),
    y: Math.max(8, Math.min(finite(saved.y, 90), height - (saved.minimized === true ? 64 : h) - 8)),
    w, h,
    dock: saved.dock === 'left' || saved.dock === 'right' ? saved.dock : 'none',
    minimized: saved.minimized === true,
  };
}
