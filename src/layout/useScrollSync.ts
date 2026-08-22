import { useEffect, useRef, type RefObject } from "react";
import type { EditorPaneHandle } from "../editor/EditorPane";
import type { PreviewPaneHandle } from "../preview/PreviewPane";
import { lineToOffset, offsetToLine, type LineAnchor } from "./scrollMapping";

/**
 * Sincroniza a rolagem do editor e do preview (#20): rolar um rola o outro
 * mantendo a posição relativa correspondente, usando as linhas de origem
 * (`data-source-line`, ver `PreviewPane.tsx`) marcadas nos blocos de topo do
 * preview como âncoras de interpolação (`scrollMapping.ts`).
 *
 * As âncoras são recalculadas ao vivo a cada evento de scroll (nunca
 * cacheadas) — isso é o que torna a sincronização tolerante a diagramas
 * mermaid que mudam de altura de forma assíncrona depois do primeiro paint:
 * o próximo evento de scroll já vê a geometria atualizada.
 */
export function useScrollSync(
  editorRef: RefObject<EditorPaneHandle | null>,
  previewRef: RefObject<PreviewPaneHandle | null>,
  source: string,
  enabled: boolean,
): void {
  // Guardado numa ref (atualizada em efeito próprio, não durante o render)
  // pra não precisar re-anexar os listeners de scroll a cada tecla digitada
  // — só o *cálculo* das âncoras precisa do texto mais recente.
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    if (!enabled) return;

    const editorHandle = editorRef.current;
    const previewHandle = previewRef.current;
    if (!editorHandle || !previewHandle) return;

    const editorScrollDOM = editorHandle.getScrollDOM();
    const previewContainer = previewHandle.getContainer();
    if (!editorScrollDOM || !previewContainer) return;

    // Evita que o scroll programático de um painel (disparado pelo scroll do
    // outro) seja, por sua vez, interpretado como um scroll do usuário —
    // o que reiniciaria o sync na direção oposta. Liberado no próximo
    // requestAnimationFrame, depois que o evento "scroll" nativo do
    // navegador (síncrono à escrita de scrollTop) já foi disparado e
    // ignorado pelo próprio listener do painel alvo.
    let syncing: "editor" | "preview" | null = null;

    function getPreviewAnchors(): LineAnchor[] {
      const container = previewContainer as HTMLDivElement;
      const containerRect = container.getBoundingClientRect();
      const blocks = container.querySelectorAll<HTMLElement>("[data-source-line]");

      const anchors: LineAnchor[] = [];
      blocks.forEach((el) => {
        const line = Number(el.dataset.sourceLine);
        if (Number.isNaN(line)) return;
        const top = el.getBoundingClientRect().top - containerRect.top + container.scrollTop;
        anchors.push({ line, top });
      });
      anchors.sort((a, b) => a.line - b.line);

      const totalLines = sourceRef.current.split("\n").length;
      const scrollHeight = container.scrollHeight;
      return [{ line: 0, top: 0 }, ...anchors, { line: totalLines, top: scrollHeight }];
    }

    function handleEditorScroll() {
      if (syncing === "editor") return;
      const line = editorHandle!.getTopVisibleLine();
      const targetTop = lineToOffset(getPreviewAnchors(), line);
      syncing = "preview";
      previewContainer!.scrollTop = targetTop;
      requestAnimationFrame(() => {
        syncing = null;
      });
    }

    function handlePreviewScroll() {
      if (syncing === "preview") return;
      const line = offsetToLine(getPreviewAnchors(), previewContainer!.scrollTop);
      syncing = "editor";
      editorHandle!.scrollToLine(line);
      requestAnimationFrame(() => {
        syncing = null;
      });
    }

    editorScrollDOM.addEventListener("scroll", handleEditorScroll);
    previewContainer.addEventListener("scroll", handlePreviewScroll);

    return () => {
      editorScrollDOM.removeEventListener("scroll", handleEditorScroll);
      previewContainer.removeEventListener("scroll", handlePreviewScroll);
    };
  }, [editorRef, previewRef, enabled]);
}
