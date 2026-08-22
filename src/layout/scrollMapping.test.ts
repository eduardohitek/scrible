import { describe, expect, it } from "vitest";
import { lineToOffset, offsetToLine, type LineAnchor } from "./scrollMapping";

describe("scrollMapping", () => {
  const anchors: LineAnchor[] = [
    { line: 0, top: 0 },
    { line: 10, top: 100 },
    { line: 20, top: 300 },
    { line: 40, top: 400 },
  ];

  it("interpola linearmente entre duas âncoras vizinhas (lineToOffset)", () => {
    expect(lineToOffset(anchors, 5)).toBe(50);
    expect(lineToOffset(anchors, 15)).toBe(200);
  });

  it("interpola linearmente entre duas âncoras vizinhas (offsetToLine)", () => {
    expect(offsetToLine(anchors, 50)).toBe(5);
    expect(offsetToLine(anchors, 200)).toBe(15);
  });

  it("bate exatamente numa âncora existente", () => {
    expect(lineToOffset(anchors, 20)).toBe(300);
    expect(offsetToLine(anchors, 300)).toBe(20);
  });

  it("extrapola usando o par inicial antes da primeira âncora", () => {
    // Linha negativa não deveria acontecer na prática (âncora sintética
    // sempre começa em 0), mas a extrapolação deve continuar a reta do
    // primeiro par de âncoras.
    expect(lineToOffset(anchors, -10)).toBe(-100);
  });

  it("extrapola usando o par final além da última âncora", () => {
    expect(lineToOffset(anchors, 60)).toBe(500);
    expect(offsetToLine(anchors, 500)).toBe(60);
  });

  it("lida com lista de uma única âncora devolvendo sempre o mesmo valor", () => {
    const single: LineAnchor[] = [{ line: 5, top: 50 }];
    expect(lineToOffset(single, 0)).toBe(50);
    expect(lineToOffset(single, 100)).toBe(50);
    expect(offsetToLine(single, 999)).toBe(5);
  });

  it("lida com lista vazia devolvendo 0", () => {
    expect(lineToOffset([], 10)).toBe(0);
    expect(offsetToLine([], 10)).toBe(0);
  });

  it("não quebra quando duas âncoras vizinhas têm a mesma chave (bloco de altura zero)", () => {
    const degenerate: LineAnchor[] = [
      { line: 0, top: 0 },
      { line: 10, top: 100 },
      { line: 10, top: 100 },
      { line: 20, top: 200 },
    ];
    expect(lineToOffset(degenerate, 10)).toBe(100);
  });

  it("é aproximadamente simétrico ida e volta", () => {
    const line = 17;
    const offset = lineToOffset(anchors, line);
    expect(offsetToLine(anchors, offset)).toBeCloseTo(line, 5);
  });
});
