import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { renderStaticBodyHtml, buildStandaloneHtml, exportActiveTabAsHtml } from "./exportHtml";
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
});

describe("buildStandaloneHtml", () => {
  it("embute tema, título e CSS sem nenhuma referência externa", () => {
    const html = buildStandaloneHtml("<p>corpo</p>", "dark", "doc.md");

    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("<title>doc.md</title>");
    expect(html).toContain("--color-bg");
    expect(html).toContain(".mermaid-diagram");
    expect(html).toContain("<p>corpo</p>");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script");
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
