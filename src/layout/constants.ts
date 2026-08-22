export const MIN_PANE_WIDTH_PX = 240;

/**
 * Converte um ratio bruto (posição do mouse / largura do container) num
 * ratio clampado que garante MIN_PANE_WIDTH_PX de largura mínima para cada
 * painel. Se o container for estreito demais para acomodar os dois mínimos
 * (min > max), cai de volta para 50/50 em vez de produzir um range inválido.
 */
export function clampSplitRatio(ratio: number, containerWidthPx: number): number {
  if (containerWidthPx <= 0) return ratio;
  const min = MIN_PANE_WIDTH_PX / containerWidthPx;
  const max = 1 - MIN_PANE_WIDTH_PX / containerWidthPx;
  if (min > max) return 0.5;
  return Math.min(max, Math.max(min, ratio));
}
