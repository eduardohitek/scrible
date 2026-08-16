import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewPane } from "./PreviewPane";

describe("PreviewPane", () => {
  it("renderiza markdown básico como HTML", async () => {
    const { container } = render(<PreviewPane source="# Olá **scrible**" />);

    await waitFor(() => {
      expect(container.querySelector("h1")).not.toBeNull();
    });

    expect(container.querySelector("h1")?.textContent).toContain("Olá");
    expect(container.querySelector("strong")?.textContent).toBe("scrible");
  });

  it("sanitiza HTML potencialmente malicioso embutido no markdown", async () => {
    const { container } = render(
      <PreviewPane source={'texto <img src=x onerror="window.__pwned = true" />'} />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain("texto");
    });

    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("isola erro de sintaxe em um diagrama mermaid sem quebrar o restante", async () => {
    const source = [
      "Antes do diagrama.",
      "",
      "```mermaid",
      "isto não é mermaid válido {{{",
      "```",
      "",
      "Depois do diagrama.",
    ].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-error")).not.toBeNull();
    });

    expect(container.textContent).toContain("Antes do diagrama.");
    expect(container.textContent).toContain("Depois do diagrama.");
  });
});
