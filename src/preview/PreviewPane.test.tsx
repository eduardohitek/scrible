import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { PreviewPane } from "./PreviewPane";
import { useThemeStore } from "../theme/themeStore";

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

  it("renderiza um diagrama mermaid válido como SVG", async () => {
    const source = ["```mermaid", "flowchart TD", "A-->B", "```"].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull();
    });

    expect(container.querySelector(".mermaid-error")).toBeNull();
  });

  it("isola 1 diagrama inválido entre 2 válidos, sem afetar os vizinhos", async () => {
    const source = [
      "```mermaid",
      "flowchart TD",
      "A-->B",
      "```",
      "",
      "```mermaid",
      "isto não é mermaid válido {{{",
      "```",
      "",
      "```mermaid",
      "flowchart TD",
      "C-->D",
      "```",
    ].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelectorAll(".mermaid-diagram svg")).toHaveLength(2);
    });

    expect(container.querySelectorAll(".mermaid-error")).toHaveLength(1);
  });

  it("renderiza um diagrama grande (30+ nós) com sucesso", async () => {
    // A garantia de "não trava a UI perceptivelmente" em si é uma propriedade
    // arquitetural (cada bloco renderiza de forma assíncrona e independente,
    // e o debounce de #17 já protege disparos vindos de digitação) — não algo
    // que um teste em jsdom meça como tempo de bloqueio real. Este teste prova
    // que o layout do mermaid não falha em escala.
    const edges = Array.from({ length: 32 }, (_, i) => `N${i}-->N${i + 1}`).join("\n");
    const source = ["```mermaid", "flowchart TD", edges, "```"].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull();
    });

    expect(container.querySelector(".mermaid-error")).toBeNull();
  });

  it("renderiza tabela GFM", async () => {
    const source = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector("table")).not.toBeNull();
    });

    const headers = Array.from(container.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["a", "b"]);
    const cells = Array.from(container.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toEqual(["1", "2"]);
  });

  it("renderiza lista de tarefas com checkboxes desabilitados", async () => {
    const source = ["- [x] feito", "- [ ] pendente"].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    });

    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true);
    expect(container.querySelectorAll("li.task-list-item")).toHaveLength(2);
  });

  it("renderiza texto riscado GFM", async () => {
    const { container } = render(<PreviewPane source="~~texto~~" />);

    await waitFor(() => {
      expect(container.querySelector("s")).not.toBeNull();
    });

    expect(container.querySelector("s")?.textContent).toBe("texto");
  });

  it("renderiza nota de rodapé", async () => {
    const source = ["Texto[^1]", "", "[^1]: Nota."].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector(".footnote-ref")).not.toBeNull();
    });

    expect(container.querySelector(".footnotes")).not.toBeNull();
  });

  it("renderiza front matter como tabela de metadados, não como hr + texto solto", async () => {
    const source = ["---", "title: Teste", "---", "# Corpo"].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector(".front-matter-table")).not.toBeNull();
    });

    const rowText = container.querySelector(".front-matter-table tr")?.textContent;
    expect(rowText).toContain("title");
    expect(rowText).toContain("Teste");
    expect(container.querySelector("hr")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Corpo");
  });

  it("sanitiza valor malicioso embutido no front matter", async () => {
    const source = [
      "---",
      'title: <img src=x onerror="window.__fmPwned = true">',
      "---",
      "corpo",
    ].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector(".front-matter-table")).not.toBeNull();
    });

    expect(container.querySelector(".front-matter-table img")).toBeNull();
    expect((window as unknown as { __fmPwned?: boolean }).__fmPwned).toBeUndefined();
  });

  it("faz debounce do re-parse ao digitar rapidamente", async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<PreviewPane source="# v1" />);
      expect(container.querySelector("h1")?.textContent).toBe("v1");

      act(() => {
        rerender(<PreviewPane source="# v2" />);
        rerender(<PreviewPane source="# v3" />);
        rerender(<PreviewPane source="# v4" />);
      });

      // Antes do debounce expirar, o preview ainda mostra a primeira versão.
      expect(container.querySelector("h1")?.textContent).toBe("v1");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(container.querySelector("h1")?.textContent).toBe("v4");
    } finally {
      vi.useRealTimers();
    }
  });

  afterEach(() => {
    useThemeStore.setState({ resolved: "light" });
  });

  it("trocar o tema resolvido reinicializa o mermaid com a paleta certa", async () => {
    const initializeSpy = vi.spyOn(mermaid, "initialize");
    const source = ["```mermaid", "isto não é mermaid válido {{{", "```"].join("\n");

    const { container } = render(<PreviewPane source={source} />);

    await waitFor(() => {
      expect(container.querySelector(".mermaid-error")).not.toBeNull();
    });
    expect(initializeSpy).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "default" }));

    initializeSpy.mockClear();
    useThemeStore.setState({ resolved: "dark" });

    await waitFor(() => {
      expect(initializeSpy).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
    });
  });
});
