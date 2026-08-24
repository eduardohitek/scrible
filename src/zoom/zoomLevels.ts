/**
 * Escada de zoom da interface (#66) — os mesmos degraus que Safari/Chrome/VS
 * Code usam (mais finos perto de 100%, mais grossos nos extremos), sempre
 * com um degrau exato em 100%.
 */
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export const DEFAULT_ZOOM = 1;

/**
 * Encaixa um valor arbitrário (ex: lido de settings.json, possivelmente
 * editado à mão) no degrau válido mais próximo. Também cobre entrada
 * inválida (não numérica, NaN, infinita), caindo em DEFAULT_ZOOM.
 */
export function snapZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ZOOM;
  return ZOOM_LEVELS.reduce((closest, level) =>
    Math.abs(level - value) < Math.abs(closest - value) ? level : closest,
  ) as number;
}

function indexOf(value: number): number {
  return ZOOM_LEVELS.indexOf(snapZoom(value) as (typeof ZOOM_LEVELS)[number]);
}

/** Um degrau acima; satura em ZOOM_LEVELS[last] (sem wrap). */
export function nextZoom(current: number): number {
  const index = indexOf(current);
  return ZOOM_LEVELS[Math.min(index + 1, ZOOM_LEVELS.length - 1)];
}

/** Um degrau abaixo; satura em ZOOM_LEVELS[0] (sem wrap). */
export function prevZoom(current: number): number {
  const index = indexOf(current);
  return ZOOM_LEVELS[Math.max(index - 1, 0)];
}
