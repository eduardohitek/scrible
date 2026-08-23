export const DEFAULT_EXPLORER_WIDTH_PX = 240;
export const MIN_EXPLORER_WIDTH_PX = 160;
export const MAX_EXPLORER_WIDTH_PX = 480;

export function clampExplorerWidth(px: number): number {
  return Math.min(MAX_EXPLORER_WIDTH_PX, Math.max(MIN_EXPLORER_WIDTH_PX, px));
}
