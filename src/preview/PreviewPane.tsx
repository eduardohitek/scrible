import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
// @ts-expect-error -- markdown-it-footnote não publica tipos
import footnote from "markdown-it-footnote";
// @ts-expect-error -- markdown-it-task-lists não publica tipos
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { useThemeStore } from "../theme/themeStore";

interface PreviewPaneProps {
  source: string;
}

/** API imperativa mínima para o sync de scroll (#20) orquestrar o preview
 * a partir de `SplitLayout`/`useScrollSync`. */
export interface PreviewPaneHandle {
  getContainer(): HTMLDivElement | null;
}

// Marca cada token de bloco de topo (level 0 — parágrafo, heading,
// blockquote, lista, tabela, fence, hr; exclui tokens aninhados como
// `list_item_open`, level 1) com a linha de origem no markdown, via
// `token.map` (já calculado pelo parser). Regra `core` hand-rolled, mesmo
// padrão de `extractFrontMatter` abaixo: sem plugin de terceiros, sem mutar
// estado de módulo dentro do useMemo de render. `data-source-line` sobrevive
// à sanitização do DOMPurify (ALLOW_DATA_ATTR é true por padrão).
function sourceLinePlugin(mdInstance: InstanceType<typeof MarkdownIt>): void {
  mdInstance.core.ruler.push("source_line_attrs", (state) => {
    for (const token of state.tokens) {
      if (token.map && token.level === 0) {
        token.attrSet("data-source-line", String(token.map[0]));
      }
    }
  });
}

// Debounce de re-parse/sanitização (150-300ms pedido pela issue #17) — ver
// `debouncedSource` abaixo, que é quem `html` deriva de fato.
const RENDER_DEBOUNCE_MS = 200;

const md = new MarkdownIt({ html: false, linkify: true })
  .use(footnote)
  // Checkboxes ficam `disabled` (padrão do plugin): o preview é somente
  // leitura, não há wiring de volta para o documento fonte.
  .use(taskLists)
  .use(sourceLinePlugin);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ParsedSource {
  frontMatter: string | null;
  body: string;
}

// Extração de front matter feita à mão, sem plugin markdown-it: precisamos
// isolar o bloco `---...---` do corpo *antes* de chamar `md.render()`
// (para renderizá-lo como tabela de metadados, não como markdown), e
// analisá-lo linha a linha (`key: value`) já que só o caso plano é exigido
// pela issue #17. Um plugin markdown-it com callback exigiria mutar uma
// variável de módulo dentro do `useMemo` de render — proibido pela regra de
// pureza do eslint-plugin-react-hooks; extrair fora do pipeline do
// markdown-it evita esse problema por completo.
function extractFrontMatter(source: string): ParsedSource {
  if (!source.startsWith("---")) return { frontMatter: null, body: source };

  const lines = source.split("\n");
  if (lines[0].trim() !== "---") return { frontMatter: null, body: source };

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) return { frontMatter: null, body: source };

  return {
    frontMatter: lines.slice(1, closingIndex).join("\n"),
    body: lines.slice(closingIndex + 1).join("\n"),
  };
}

function parseFrontMatter(raw: string): Array<[string, string]> {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line): [string, string] | null => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) return null;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return key ? [key, value] : null;
    })
    .filter((entry): entry is [string, string] => entry !== null);
}

function renderFrontMatterTable(fm: string): string {
  const entries = parseFrontMatter(fm);
  if (entries.length === 0) return "";
  const rows = entries
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  return `<div class="front-matter"><table class="front-matter-table"><tbody>${rows}</tbody></table></div>`;
}

let mermaidIdCounter = 0;

/**
 * Pipeline de preview: markdown-it (GFM completo, front matter, notas de
 * rodapé) com sanitização via DOMPurify, e renderização de blocos
 * ```mermaid``` via mermaid.js.
 */
export const PreviewPane = forwardRef<PreviewPaneHandle, PreviewPaneProps>(function PreviewPane(
  { source },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ getContainer: () => containerRef.current }), []);
  const resolvedTheme = useThemeStore((state) => state.resolved);

  // Debounce do parse/sanitização: o primeiro render é imediato (useState já
  // inicializa com `source`); mudanças seguintes só disparam um novo parse
  // depois de RENDER_DEBOUNCE_MS de silêncio.
  const [debouncedSource, setDebouncedSource] = useState(source);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSourceEffectRef = useRef(true);

  useEffect(() => {
    if (isFirstSourceEffectRef.current) {
      isFirstSourceEffectRef.current = false;
      return;
    }

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setDebouncedSource(source);
    }, RENDER_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [source]);

  // Derivação pura de `debouncedSource` — sem efeito colateral.
  const html = useMemo(() => {
    const { frontMatter, body } = extractFrontMatter(debouncedSource);
    const bodyHtml = md.render(body);
    const metadataHtml = frontMatter ? renderFrontMatterTable(frontMatter) : "";
    return DOMPurify.sanitize(metadataHtml + bodyHtml);
  }, [debouncedSource]);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: resolvedTheme === "dark" ? "dark" : "default",
    });

    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    container.innerHTML = html;

    const blocks = container.querySelectorAll<HTMLElement>(
      'code.language-mermaid, pre > code[class*="mermaid"]',
    );

    blocks.forEach(async (block) => {
      const graphDefinition = block.textContent ?? "";
      const id = `mermaid-${mermaidIdCounter++}`;
      const pre = block.parentElement;
      if (!pre) return;

      // `data-source-line` (#20) vive no <code> (é onde markdown-it renderiza
      // os atributos de um token `fence`) — precisa ser copiado pro elemento
      // que substitui o <pre> pra não perder a âncora de scroll sync.
      const sourceLine = block.dataset.sourceLine;

      try {
        const { svg } = await mermaid.render(id, graphDefinition);
        if (cancelled) return;
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-diagram";
        wrapper.innerHTML = svg;
        if (sourceLine !== undefined) wrapper.dataset.sourceLine = sourceLine;
        pre.replaceWith(wrapper);
      } catch (err) {
        if (cancelled) return;
        const errorBox = document.createElement("div");
        errorBox.className = "mermaid-error";
        errorBox.textContent = `Erro de sintaxe no diagrama: ${
          err instanceof Error ? err.message : String(err)
        }`;
        if (sourceLine !== undefined) errorBox.dataset.sourceLine = sourceLine;
        pre.replaceWith(errorBox);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [html, resolvedTheme]);

  return <div className="preview-pane" ref={containerRef} />;
});
