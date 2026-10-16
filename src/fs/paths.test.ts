import { describe, expect, it } from "vitest";
import { normalizePath } from "./paths";

describe("normalizePath", () => {
  it("converte separadores do Windows para /", () => {
    expect(normalizePath("C:\\Users\\ed\\Documents\\scrible")).toBe("C:/Users/ed/Documents/scrible");
  });

  it("mantém caminhos POSIX intactos", () => {
    expect(normalizePath("/Users/ed/Documents/scrible")).toBe("/Users/ed/Documents/scrible");
  });

  it("normaliza separadores mistos", () => {
    expect(normalizePath("C:\\Users\\ed/Documents\\a.md")).toBe("C:/Users/ed/Documents/a.md");
  });
});
