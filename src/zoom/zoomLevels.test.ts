import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, nextZoom, prevZoom, snapZoom, ZOOM_LEVELS } from "./zoomLevels";

describe("zoomLevels", () => {
  it("nextZoom anda um degrau acima", () => {
    expect(nextZoom(1)).toBe(1.1);
    expect(nextZoom(0.5)).toBe(0.67);
  });

  it("prevZoom anda um degrau abaixo", () => {
    expect(prevZoom(1)).toBe(0.9);
    expect(prevZoom(2)).toBe(1.75);
  });

  it("nextZoom satura no último degrau, sem wrap", () => {
    expect(nextZoom(2)).toBe(2);
  });

  it("prevZoom satura no primeiro degrau, sem wrap", () => {
    expect(prevZoom(0.5)).toBe(0.5);
  });

  it("snapZoom encaixa valores fora da escada no degrau mais próximo", () => {
    expect(snapZoom(0.99)).toBe(1);
    expect(snapZoom(1.3)).toBe(1.25);
    expect(snapZoom(10)).toBe(2);
    expect(snapZoom(-5)).toBe(0.5);
  });

  it("snapZoom cai em DEFAULT_ZOOM para entrada inválida", () => {
    expect(snapZoom(NaN)).toBe(DEFAULT_ZOOM);
    expect(snapZoom(Infinity)).toBe(DEFAULT_ZOOM);
    expect(snapZoom("1.5")).toBe(DEFAULT_ZOOM);
    expect(snapZoom(null)).toBe(DEFAULT_ZOOM);
    expect(snapZoom(undefined)).toBe(DEFAULT_ZOOM);
  });

  it("ZOOM_LEVELS contém um degrau exato em 100%", () => {
    expect(ZOOM_LEVELS).toContain(1);
  });
});
