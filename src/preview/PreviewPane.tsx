import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { useThemeStore } from "../theme/themeStore";
import { prepareLocalLinks } from "./localLinks";
import { md, extractFrontMatter, renderFrontMatterTable } from "./markdownPipeline";
import { collectOpenOpenApiKeys, renderOpenApiBlocks } from "./openapi/blocks";

interface PreviewPaneProps {
  source: string;
  documentPath?: string;
  workspaceRoot?: string | null;
}

/** API imperativa mínima para o sync de scroll (#20) orquestrar o preview
 * a partir de `SplitLayout`/`useScrollSync`. */
export interface PreviewPaneHandle {
  getContainer(): HTMLDivElement | null;
}

// Debounce de re-parse/sanitização (150-300ms pedido pela issue #17) — ver
// `debouncedSource` abaixo, que é quem `html` deriva de fato.
const RENDER_DEBOUNCE_MS = 200;

let mermaidIdCounter = 0;

/**
 * Pipeline de preview: markdown-it (GFM completo, front matter, notas de
 * rodapé) com sanitização via DOMPurify, renderização de blocos
 * ```mermaid``` via mermaid.js e de blocos ```openapi```/```swagger``` (#97).
 */
export const PreviewPane = forwardRef<PreviewPaneHandle, PreviewPaneProps>(function PreviewPane(
  { source, documentPath, workspaceRoot },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ getContainer: () => containerRef.current }), []);
  const resolvedTheme = useThemeStore((state) => state.resolved);

  // Debounce do parse/sanitização: o primeiro render é imediato (useState já
  // inicializa com `source`); mudanças seguintes só disparam um novo parse
  // depois de RENDER_DEBOUNCE_MS de silêncio.
  const [debounced, setDebounced] = useState({ source, documentPath });
  // A tab switch must not resolve the previous document's URLs against the new path.
  const debouncedSource = debounced.documentPath === documentPath ? debounced.source : source;
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
      setDebounced({ source, documentPath });
    }, RENDER_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [source, documentPath]);

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
    const openKeys = collectOpenOpenApiKeys(container);
    container.innerHTML = html;
    renderOpenApiBlocks(container, { openKeys });
    const cleanupLinks = documentPath && workspaceRoot
      ? prepareLocalLinks(container, documentPath, workspaceRoot)
      : undefined;

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
      cleanupLinks?.();
    };
  }, [html, resolvedTheme, documentPath, workspaceRoot]);

  return <div className="preview-pane" ref={containerRef} />;
});
