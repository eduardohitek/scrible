import { describe, expect, it } from "vitest";
import { clampSplitRatio, MIN_PANE_WIDTH_PX } from "./constants";

describe("clampSplitRatio", () => {
  it("não altera um ratio já dentro dos limites", () => {
    expect(clampSplitRatio(0.5, 1000)).toBe(0.5);
  });

  it("clampa no mínimo quando o ratio daria menos que MIN_PANE_WIDTH_PX ao editor", () => {
    const containerWidth = 1000;
    const ratio = clampSplitRatio(0.01, containerWidth);
    expect(ratio * containerWidth).toBeCloseTo(MIN_PANE_WIDTH_PX);
  });

  it("clampa no máximo quando o ratio daria menos que MIN_PANE_WIDTH_PX ao preview", () => {
    const containerWidth = 1000;
    const ratio = clampSplitRatio(0.99, containerWidth);
    expect((1 - ratio) * containerWidth).toBeCloseTo(MIN_PANE_WIDTH_PX);
  });

  it("cai para 50/50 quando o container é estreito demais para os dois mínimos", () => {
    expect(clampSplitRatio(0.5, 300)).toBe(0.5);
  });

  it("largura zero/negativa retorna o ratio bruto (sem divisão por zero)", () => {
    expect(clampSplitRatio(0.5, 0)).toBe(0.5);
  });
});
