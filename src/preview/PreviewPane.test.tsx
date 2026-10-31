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

  describe("blocos OpenAPI (#97)", () => {
    const openapiBlock = (title: string, extra = "") =>
      [
        "```openapi",
        "openapi: 3.1.0",
        `info: {title: ${title}, version: '1.0'}`,
        "servers: [{url: 'https://api.example.com'}]",
        "paths:",
        "  /pets:",
        "    get:",
        "      tags: [pets]",
        "      summary: Lista pets",
        "      parameters:",
        "        - {name: limit, in: query, schema: {type: integer}}",
        "      responses:",
        "        '200': {description: OK}",
        "    post:",
        "      tags: [pets]",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema: {type: object}",
        "      responses:",
        "        '201': {description: Criado}",
        extra,
        "```",
      ].join("\n");

    it("renderiza info, servers e endpoints recolhidos agrupados por tag", async () => {
      const { container } = render(<PreviewPane source={openapiBlock("Petstore")} />);

      await waitFor(() => expect(container.querySelector(".openapi")).not.toBeNull());

      expect(container.querySelector("pre")).toBeNull();
      expect(container.querySelector(".openapi-title")?.textContent).toContain("Petstore");
      expect(container.querySelector(".openapi-servers")?.textContent).toContain("https://api.example.com");
      expect(container.querySelector(".openapi-tag-name")?.textContent).toBe("pets");

      const operations = Array.from(container.querySelectorAll<HTMLDetailsElement>("details.openapi-operation"));
      expect(operations.map((d) => d.querySelector("summary")?.textContent)).toEqual([
        "GET/petsLista pets",
        "POST/pets",
      ]);
      expect(operations.every((d) => !d.open)).toBe(true);
      expect(operations[0].querySelector(".openapi-table")?.textContent).toContain("limit");
      expect(operations[1].textContent).toContain("application/json");
    });

    it("isola 1 bloco inválido entre 2 válidos", async () => {
      const source = [openapiBlock("Primeira"), "", "```openapi", "openapi: 3.1.0\ninfo\n  x: [", "```", "", openapiBlock("Terceira")].join(
        "\n",
      );

      const { container } = render(<PreviewPane source={source} />);

      await waitFor(() => expect(container.querySelectorAll(".openapi")).toHaveLength(2));
      const errors = container.querySelectorAll(".openapi-error");
      expect(errors).toHaveLength(1);
      expect(errors[0].textContent).toContain("Erro de sintaxe na linha");
      const titles = Array.from(container.querySelectorAll(".openapi-title"), (el) => el.textContent);
      expect(titles[0]).toContain("Primeira");
      expect(titles[1]).toContain("Terceira");
    });

    it("mostra erro de Swagger 2.0 não suportado no bloco ```swagger", async () => {
      const source = ["```swagger", 'swagger: "2.0"', "info: {title: Velha, version: '1'}", "```"].join("\n");

      const { container } = render(<PreviewPane source={source} />);

      await waitFor(() => expect(container.querySelector(".openapi-error")).not.toBeNull());
      expect(container.querySelector(".openapi-error")?.textContent).toContain("Swagger 2.0 não suportado");
    });

    it("escapa HTML vindo do documento: <script> em description vira texto", async () => {
      const source = [
        "```openapi",
        "openapi: 3.1.0",
        "info:",
        "  title: '<img src=x onerror=\"window.__oaPwned = true\">'",
        "  version: '1'",
        "  description: '<script>window.__oaPwned = true</script>'",
        "```",
      ].join("\n");

      const { container } = render(<PreviewPane source={source} />);

      await waitFor(() => expect(container.querySelector(".openapi")).not.toBeNull());
      expect(container.querySelector(".openapi script")).toBeNull();
      expect(container.querySelector(".openapi img")).toBeNull();
      expect(container.querySelector(".openapi-description")?.textContent).toBe(
        "<script>window.__oaPwned = true</script>",
      );
      expect((window as unknown as { __oaPwned?: boolean }).__oaPwned).toBeUndefined();
    });

    it("mantém aberto o endpoint expandido quando o documento é re-renderizado", async () => {
      const { container, rerender } = render(<PreviewPane source={openapiBlock("v1")} />);
      await waitFor(() => expect(container.querySelector(".openapi")).not.toBeNull());
      container.querySelector<HTMLDetailsElement>("details.openapi-operation")!.open = true;

      rerender(<PreviewPane source={openapiBlock("v2")} />);

      await waitFor(() => expect(container.querySelector(".openapi-title")?.textContent).toContain("v2"));
      const operations = container.querySelectorAll<HTMLDetailsElement>("details.openapi-operation");
      expect(operations[0].open).toBe(true);
      expect(operations[1].open).toBe(false);
    });

    describe("seção Schemas (#98)", () => {
      const schemasBlock = [
        "```openapi",
        "openapi: 3.1.0",
        "info: {title: Zoo, version: '1'}",
        "paths:",
        "  /pets:",
        "    get:",
        "      responses:",
        "        '200':",
        "          description: OK",
        "          content:",
        "            application/json:",
        "              schema: {type: array, items: {$ref: '#/components/schemas/Pet'}}",
        "components:",
        "  schemas:",
        "    Pet:",
        "      type: object",
        "      required: [id]",
        "      properties:",
        "        id: {type: integer, format: int64, description: Identificador}",
        "        status: {type: string, enum: [disponível, vendido]}",
        "        owner:",
        "          type: object",
        "          properties:",
        "            name: {type: string}",
        "        friends: {type: array, items: {$ref: '#/components/schemas/Pet'}}",
        "    Dog:",
        "      allOf:",
        "        - $ref: '#/components/schemas/Pet'",
        "        - type: object",
        "          properties:",
        "            bark: {type: boolean}",
        "```",
      ].join("\n");

      async function renderSchemas() {
        const view = render(<PreviewPane source={schemasBlock} />);
        await waitFor(() => expect(view.container.querySelector(".openapi-schemas")).not.toBeNull());
        return view.container;
      }

      it("lista cada schema num <details> com âncora, propriedades, required, formato e enum", async () => {
        const container = await renderSchemas();

        const schemas = Array.from(container.querySelectorAll<HTMLDetailsElement>("details.openapi-schema"));
        expect(schemas.map((d) => d.id)).toEqual(["openapi-0-schema-Pet", "openapi-0-schema-Dog"]);
        expect(schemas.every((d) => !d.open)).toBe(true);

        const props = Array.from(schemas[0].querySelectorAll(":scope > div > .openapi-schema-children > ul > li"));
        expect(props.map((li) => li.querySelector(".openapi-prop-name")?.textContent)).toEqual([
          "id",
          "status",
          "owner",
          "friends",
        ]);
        expect(props[0].textContent).toContain("obrigatório");
        expect(props[0].textContent).toContain("int64");
        expect(props[0].textContent).toContain("Identificador");
        expect(props[1].querySelector(".openapi-enum")?.textContent).toBe("enum: disponível, vendido");
      });

      it("objeto aninhado vira <details> expansível", async () => {
        const container = await renderSchemas();
        const owner = Array.from(container.querySelectorAll("li.openapi-prop")).find(
          (li) => li.querySelector(":scope > details > summary > .openapi-prop-name")?.textContent === "owner",
        );
        const nested = owner?.querySelector<HTMLDetailsElement>(":scope > details.openapi-prop-details");
        expect(nested).not.toBeNull();
        expect(nested?.querySelector(".openapi-schema-children")?.textContent).toContain("name");
      });

      it("array de $ref e $ref do corpo da resposta viram link para a âncora do schema", async () => {
        const container = await renderSchemas();

        const responseLink = container.querySelector<HTMLAnchorElement>(".openapi-operation a.openapi-schema-ref");
        expect(responseLink?.getAttribute("href")).toBe("#openapi-0-schema-Pet");
        expect(responseLink?.closest("li")?.textContent).toContain("array<Pet");
      });

      it("ciclo aparece como referência marcada, sem expandir de novo", async () => {
        const container = await renderSchemas();
        const pet = container.querySelector("#openapi-0-schema-Pet")!;
        const friends = Array.from(pet.querySelectorAll("li.openapi-prop")).find(
          (li) => li.querySelector(".openapi-prop-name")?.textContent === "friends",
        )!;

        expect(friends.querySelector("a.openapi-schema-ref")?.getAttribute("href")).toBe("#openapi-0-schema-Pet");
        expect(friends.querySelector(".openapi-circular")).not.toBeNull();
        expect(friends.querySelector("details")).toBeNull();
      });

      it("allOf aparece como subgrupo rotulado", async () => {
        const container = await renderSchemas();
        const dog = container.querySelector("#openapi-0-schema-Dog")!;
        const group = dog.querySelector(".openapi-schema-group");

        expect(group?.querySelector(".openapi-group-label")?.textContent).toBe("todos de (allOf)");
        expect(group?.querySelector("a.openapi-schema-ref")?.textContent).toBe("Pet");
        expect(group?.textContent).toContain("bark");
      });
    });

    it("preserva data-source-line no bloco renderizado", async () => {
      const { container } = render(<PreviewPane source={`# Título\n\n${openapiBlock("X")}`} />);
      await waitFor(() => expect(container.querySelector(".openapi")).not.toBeNull());
      expect(container.querySelector<HTMLElement>(".openapi")?.dataset.sourceLine).toBe("2");
    });
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
