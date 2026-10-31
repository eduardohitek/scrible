import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  renderStaticBodyHtml,
  buildStandaloneHtml,
  exportActiveTabAsHtml,
  exportActiveTabAsPdf,
} from "./exportHtml";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore, type DocumentEntry } from "../store/documentStore";
import { useThemeStore } from "../theme/themeStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);

function docEntry(overrides: Partial<DocumentEntry> = {}): DocumentEntry {
  return {
    path: "/root/doc.md",
    content: "",
    lastSavedMtime: 1000,
    status: "idle",
    conflict: null,
    dirty: false,
    ...overrides,
  };
}

describe("renderStaticBodyHtml", () => {
  it("renderiza markdown básico e sanitiza HTML malicioso", async () => {
    const html = await renderStaticBodyHtml(
      '# Título\n\ntexto <img src=x onerror="window.__pwned = true" />',
      "light",
    );
    expect(html).toContain(">Título</h1>");
    expect(html).not.toContain("<img");
  });

  it("resolve um diagrama mermaid válido como SVG estático", async () => {
    const source = ["```mermaid", "flowchart TD", "A-->B", "```"].join("\n");
    const html = await renderStaticBodyHtml(source, "light");
    expect(html).toContain('class="mermaid-diagram"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("language-mermaid");
  });

  it("isola erro de sintaxe de um diagrama mermaid inválido", async () => {
    const source = ["```mermaid", "isto não é mermaid válido {{{", "```"].join("\n");
    const html = await renderStaticBodyHtml(source, "light");
    expect(html).toContain('class="mermaid-error"');
  });

  const openapiSource = [
    "```openapi",
    "openapi: 3.1.0",
    "info: {title: Petstore, version: '1'}",
    "paths:",
    "  /pets:",
    "    get: {summary: Lista, responses: {'200': {description: OK}}}",
    "components:",
    "  schemas:",
    "    Pet: {type: object, properties: {id: {type: integer}}}",
    "```",
  ].join("\n");

  it("renderiza blocos OpenAPI (#99) sem o código cru, fechados no HTML", async () => {
    const html = await renderStaticBodyHtml(openapiSource, "light");

    expect(html).toContain('class="openapi"');
    expect(html).toContain('class="openapi-operation openapi-method-get"');
    expect(html).toContain('id="openapi-0-schema-Pet"');
    expect(html).not.toContain("language-openapi");
    expect(html).not.toContain("openapi: 3.1.0");
    expect(html).not.toMatch(/<details[^>]*\sopen[\s=>]/);
  });

  it("abre todos os <details> OpenAPI com expandOpenApi (PDF)", async () => {
    const container = document.createElement("div");
    container.innerHTML = await renderStaticBodyHtml(openapiSource, "light", { expandOpenApi: true });

    const details = Array.from(container.querySelectorAll("details"));
    expect(details.length).toBeGreaterThan(1);
    expect(details.every((d) => d.open)).toBe(true);
  });

  it("isola bloco OpenAPI inválido", async () => {
    const html = await renderStaticBodyHtml(['```swagger', 'swagger: "2.0"', "```"].join("\n"), "light");
    expect(html).toContain('class="openapi-error"');
    expect(html).toContain("Swagger 2.0 não suportado");
  });
});

describe("buildStandaloneHtml", () => {
  it("embute tema, título e CSS sem nenhuma referência externa", () => {
    const html = buildStandaloneHtml("<p>corpo</p>", "dark", "doc.md");

    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("<title>doc.md</title>");
    expect(html).toContain("--color-bg");
    expect(html).toContain(".mermaid-diagram");
    expect(html).toContain(".openapi-operation");
    expect(html).toContain("--color-http-get");
    expect(html).toContain("<p>corpo</p>");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
  });

  it("embute CSS extra quando fornecido (uso do export de PDF)", () => {
    const html = buildStandaloneHtml("<p>corpo</p>", "light", "doc.md", "@media print { body { color: red } }");

    expect(html).toContain("@media print");
  });
});

describe("exportActiveTabAsHtml", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedSave.mockReset();
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: [{ id: "tab-1", path: "/root/doc.md", title: "doc.md" }],
      activeTabId: "tab-1",
      editingTabId: null,
    });
    useDocumentStore.setState({
      documents: { "tab-1": docEntry({ content: "# Olá" }) },
    });
    useThemeStore.setState({ preference: "light", resolved: "light" });
  });

  it("no-op se o usuário cancelar o diálogo de salvar", async () => {
    mockedSave.mockResolvedValueOnce(null);
    await exportActiveTabAsHtml();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("escreve o HTML exportado no path escolhido pelo diálogo", async () => {
    mockedSave.mockResolvedValueOnce("/root/doc.html");
    mockedInvoke.mockResolvedValueOnce(undefined);

    await exportActiveTabAsHtml();

    expect(mockedSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "/root/doc.html" }),
    );
    expect(mockedInvoke).toHaveBeenCalledWith("write_export_file", {
      path: "/root/doc.html",
      content: expect.stringContaining(">Olá</h1>"),
    });
  });
});

describe("exportActiveTabAsPdf", () => {
  beforeEach(() => {
    useTabsStore.setState({
      workspaceRoot: "/root",
      tabs: [{ id: "tab-1", path: "/root/doc.md", title: "doc.md" }],
      activeTabId: "tab-1",
      editingTabId: null,
    });
    useDocumentStore.setState({
      documents: { "tab-1": docEntry({ content: "# Olá" }) },
    });
    // Tema da UI é escuro, mas o PDF deve sempre sair em tema claro (#27) —
    // divergência consciente da decisão de #26 de congelar no tema da tela.
    useThemeStore.setState({ preference: "dark", resolved: "dark" });
  });

  // A geração do PDF em si (WKWebView.createPDF() nativo, comando Rust
  // `export_pdf`) não é exercitável em jsdom/vitest — mesma postura já
  // registrada em #12/#22/#23/#24 pra integrações nativas sem precedente de
  // teste no repo. O teste cobre o que é puro/determinístico do lado JS:
  // diálogo de salvar, tema sempre claro, payload do comando.
  it("no-op se o usuário cancelar o diálogo de salvar", async () => {
    mockedSave.mockReset();
    mockedInvoke.mockReset();
    mockedSave.mockResolvedValueOnce(null);

    await exportActiveTabAsPdf();

    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("chama export_pdf com o path escolhido e HTML sempre em tema claro", async () => {
    mockedSave.mockReset();
    mockedInvoke.mockReset();
    mockedSave.mockResolvedValueOnce("/root/doc.pdf");
    mockedInvoke.mockResolvedValueOnce(undefined);

    await exportActiveTabAsPdf();

    expect(mockedSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/root/doc.pdf" }));
    expect(mockedInvoke).toHaveBeenCalledWith("export_pdf", {
      path: "/root/doc.pdf",
      html: expect.stringContaining(">Olá</h1>"),
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      "export_pdf",
      expect.objectContaining({ html: expect.stringContaining('data-theme="light"') }),
    );
  });

  it("manda os blocos OpenAPI com todos os <details> abertos (#99)", async () => {
    mockedSave.mockReset();
    mockedInvoke.mockReset();
    mockedSave.mockResolvedValueOnce("/root/doc.pdf");
    useDocumentStore.setState({
      documents: {
        "tab-1": docEntry({
          content: "```openapi\nopenapi: 3.1.0\ninfo: {title: X, version: '1'}\npaths: {/a: {get: {responses: {'200': {description: OK}}}}}\n```",
        }),
      },
    });

    await exportActiveTabAsPdf();

    const { html } = mockedInvoke.mock.calls[0][1] as { html: string };
    expect(html).toMatch(/<details[^>]*\sopen[\s=>]/);
    expect(html).toContain(".openapi summary");
  });

  it("no-op se não houver aba ativa", async () => {
    mockedSave.mockReset();
    useTabsStore.setState({ activeTabId: null });
    await exportActiveTabAsPdf();
    expect(mockedSave).not.toHaveBeenCalled();
  });
});
