import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { md, extractFrontMatter, renderFrontMatterTable, escapeHtml } from "../preview/markdownPipeline";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore } from "../store/documentStore";
import { useThemeStore } from "../theme/themeStore";
import tokensCss from "../theme/tokens.css?raw";
import previewCss from "../preview/PreviewPane.css?raw";
import printCss from "./print.css?raw";

// Boilerplate mínimo de plataforma (não é "conteúdo" do preview, por isso não
// vive em PreviewPane.css): força color-scheme pro tema congelado no momento
// do export e replica a regra base de fonte/cor/fundo do body (App.css).
const PLATFORM_CSS = `
:root { color-scheme: light dark; }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
body { font-family: var(--font-reading); color: var(--color-text); background: var(--color-bg); }
`;

let exportMermaidIdCounter = 0;

/**
 * Renderiza `source` (conteúdo vivo da aba, não debounced) pelo mesmo
 * pipeline de `PreviewPane.tsx`, resolvendo diagramas mermaid para SVG
 * estático de forma síncrona/aguardada — ao contrário do efeito ao vivo
 * (fire-and-forget), o export precisa que todo `mermaid.render` termine
 * antes de ler o HTML final.
 */
export async function renderStaticBodyHtml(source: string, theme: "light" | "dark"): Promise<string> {
  const { frontMatter, body } = extractFrontMatter(source);
  const bodyHtml = md.render(body);
  const metadataHtml = frontMatter ? renderFrontMatterTable(frontMatter) : "";
  const html = DOMPurify.sanitize(metadataHtml + bodyHtml);

  // Container desanexado: nunca inserido no DOM visível. mermaid.render()
  // gerencia seu próprio elemento temporário internamente, então não depende
  // deste container estar anexado — só o usamos para querySelectorAll/
  // replaceWith puros do DOM.
  const container = document.createElement("div");
  container.innerHTML = html;

  mermaid.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default" });

  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('code.language-mermaid, pre > code[class*="mermaid"]'),
  );

  await Promise.all(
    blocks.map(async (block) => {
      const graphDefinition = block.textContent ?? "";
      const id = `export-mermaid-${exportMermaidIdCounter++}`;
      const pre = block.parentElement;
      if (!pre) return;

      const sourceLine = block.dataset.sourceLine;

      try {
        const { svg } = await mermaid.render(id, graphDefinition);
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-diagram";
        wrapper.innerHTML = svg;
        if (sourceLine !== undefined) wrapper.dataset.sourceLine = sourceLine;
        pre.replaceWith(wrapper);
      } catch (err) {
        const errorBox = document.createElement("div");
        errorBox.className = "mermaid-error";
        errorBox.textContent = `Erro de sintaxe no diagrama: ${
          err instanceof Error ? err.message : String(err)
        }`;
        if (sourceLine !== undefined) errorBox.dataset.sourceLine = sourceLine;
        pre.replaceWith(errorBox);
      }
    }),
  );

  return container.innerHTML;
}

/** Monta o documento HTML standalone completo: CSS embutido (tokens reais +
 * estilos de conteúdo do preview, via import `?raw`), sem nenhuma
 * dependência externa (fontes, scripts, requisições de rede). */
export function buildStandaloneHtml(
  bodyHtml: string,
  theme: "light" | "dark",
  title: string,
  extraCss = "",
): string {
  return `<!doctype html>
<html data-theme="${theme}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${PLATFORM_CSS}
${tokensCss}
${previewCss}
${extraCss}
</style>
</head>
<body><div class="preview-pane">${bodyHtml}</div></body>
</html>
`;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Exporta a aba ativa como um `.html` standalone (#26): diálogo nativo de
 * salvar, tema congelado no valor atualmente resolvido na tela. No-op se não
 * houver aba ativa ou o usuário cancelar o diálogo. */
export async function exportActiveTabAsHtml(): Promise<void> {
  const { activeTabId, tabs } = useTabsStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const entry = useDocumentStore.getState().documents[tab.id];
  const resolvedTheme = useThemeStore.getState().resolved;

  const defaultName = tab.title.replace(/\.md$/, ".html");
  const path = await save({
    title: "Exportar para HTML",
    defaultPath: `${dirname(tab.path)}/${defaultName}`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (typeof path !== "string") return;

  const bodyHtml = await renderStaticBodyHtml(entry?.content ?? "", resolvedTheme);
  const html = buildStandaloneHtml(bodyHtml, resolvedTheme, tab.title);
  await invoke("write_export_file", { path, content: html });
}

/** Exporta a aba ativa como PDF (#27), via `WKWebView.createPDF()` nativo no
 * lado Rust (comando `export_pdf`, macOS-only) — `window.print()` não faz
 * nada no WKWebView do Tauri/wry, limitação confirmada na verificação manual
 * e documentada upstream (github.com/tauri-apps/wry#707). Ao contrário do
 * export de HTML, o tema é sempre claro — critério de aceite literal da
 * issue, para poupar tinta na leitura impressa —, desviando conscientemente
 * da decisão de #26 de congelar no tema resolvido da tela. No-op se não
 * houver aba ativa ou o usuário cancelar o diálogo de salvar. */
export async function exportActiveTabAsPdf(): Promise<void> {
  const { activeTabId, tabs } = useTabsStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const defaultName = tab.title.replace(/\.md$/, ".pdf");
  const path = await save({
    title: "Exportar para PDF",
    defaultPath: `${dirname(tab.path)}/${defaultName}`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (typeof path !== "string") return;

  const entry = useDocumentStore.getState().documents[tab.id];

  const bodyHtml = await renderStaticBodyHtml(entry?.content ?? "", "light");
  const html = buildStandaloneHtml(bodyHtml, "light", tab.title, printCss);
  await invoke("export_pdf", { html, path });
}
