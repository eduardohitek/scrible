import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePath } from "./paths";

afterEach(() => vi.restoreAllMocks());

describe("normalizePath", () => {
  it("no Windows converte separadores para /", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    expect(normalizePath("C:\\Users\\ed\\Documents\\scrible")).toBe("C:/Users/ed/Documents/scrible");
    expect(normalizePath("C:\\Users\\ed/Documents\\a.md")).toBe("C:/Users/ed/Documents/a.md");
  });

  it("no Windows mantém caminhos já normalizados", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    expect(normalizePath("C:/Users/ed/a.md")).toBe("C:/Users/ed/a.md");
  });

  it.each(["MacIntel", "Linux x86_64"])("em %s preserva barra invertida (caractere válido)", (platform) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    expect(normalizePath("/tmp/a\\b.md")).toBe("/tmp/a\\b.md");
  });
});
