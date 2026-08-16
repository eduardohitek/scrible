import { useEffect, useMemo, useRef } from "react";
import MarkdownIt from "markdown-it";
// @ts-expect-error -- markdown-it-footnote não publica tipos
import footnote from "markdown-it-footnote";
import DOMPurify from "dompurify";
import mermaid from "mermaid";

interface PreviewPaneProps {
  source: string;
}

const md = new MarkdownIt({ html: false, linkify: true }).use(footnote);

mermaid.initialize({ startOnLoad: false, theme: "default" });

let mermaidIdCounter = 0;

/**
 * Pipeline mínimo de preview para provar o scaffold: markdown-it (GFM básico
 * + notas de rodapé) com sanitização via DOMPurify, e renderização de blocos
 * ```mermaid``` via mermaid.js. O pipeline completo (front matter, GFM
 * integral, sincronização de rolagem) é implementado nas issues dedicadas.
 */
export function PreviewPane({ source }: PreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Derivação pura de `source` — sem efeito colateral, não precisa de useEffect+useState.
  const html = useMemo(() => DOMPurify.sanitize(md.render(source)), [source]);

  useEffect(() => {
    if (!containerRef.current) return;
    const blocks = containerRef.current.querySelectorAll<HTMLElement>(
      'code.language-mermaid, pre > code[class*="mermaid"]',
    );

    blocks.forEach(async (block) => {
      const graphDefinition = block.textContent ?? "";
      const id = `mermaid-${mermaidIdCounter++}`;
      const pre = block.parentElement;
      if (!pre) return;

      try {
        const { svg } = await mermaid.render(id, graphDefinition);
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-diagram";
        wrapper.innerHTML = svg;
        pre.replaceWith(wrapper);
      } catch (err) {
        const errorBox = document.createElement("div");
        errorBox.className = "mermaid-error";
        errorBox.textContent = `Erro de sintaxe no diagrama: ${
          err instanceof Error ? err.message : String(err)
        }`;
        pre.replaceWith(errorBox);
      }
    });
  }, [html]);

  return (
    <div
      className="preview-pane"
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
