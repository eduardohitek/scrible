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
 *
 * O listener de "scroll" é anexado uma única vez, em delegação (fase de
 * *capture*), no container estável de `SplitLayout` (`containerRef`, o
 * `.app-main` que nunca é destruído/recriado) — não diretamente no
 * `scrollDOM`/container de `EditorPane`/`PreviewPane`. "scroll" não faz
 * bubbling, mas ainda passa pela fase de captura ao descer até o alvo, então
 * um listener `{capture: true}` num ancestral estável recebe o evento de
 * qualquer descendente que role. Isso importa porque `EditorPane` destrói e
 * recria seu `EditorView` (logo, um novo `scrollDOM`) sempre que monta pela
 * primeira vez sob `React.StrictMode` (dev) — capturar `getScrollDOM()` uma
 * única vez no setup do efeito (abordagem anterior) grudava o listener no
 * elemento morto da primeira instância. Resolvendo a handle/elemento atual a
 * cada evento (nunca cacheado), a sincronização sobrevive a qualquer
 * remontagem do editor sem precisar corrigir manualmente a lista de
 * dependências do efeito toda vez que aparecer um novo cenário desses.
 */
export function useScrollSync(
  containerRef: RefObject<HTMLElement | null>,
  editorRef: RefObject<EditorPaneHandle | null>,
  previewRef: RefObject<PreviewPaneHandle | null>,
  source: string,
  enabled: boolean,
): void {
  // Guardado numa ref (atualizada em efeito próprio, não durante o render)
  // pra não precisar re-anexar o listener a cada tecla digitada — só o
  // *cálculo* das âncoras precisa do texto mais recente.
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    if (!enabled) return;
    const root = containerRef.current;
    if (!root) return;

    // Evita que o scroll programático de um painel (disparado pelo scroll do
    // outro) seja, por sua vez, interpretado como um scroll do usuário —
    // o que reiniciaria o sync na direção oposta. Liberado no próximo
    // requestAnimationFrame, depois que o evento "scroll" nativo do
    // navegador (síncrono à escrita de scrollTop) já foi disparado e
    // ignorado pelo próprio listener do painel alvo.
    let syncing: "editor" | "preview" | null = null;

    function getPreviewAnchors(previewContainer: HTMLElement): LineAnchor[] {
      const containerRect = previewContainer.getBoundingClientRect();
      const blocks = previewContainer.querySelectorAll<HTMLElement>("[data-source-line]");

      const anchors: LineAnchor[] = [];
      blocks.forEach((el) => {
        const line = Number(el.dataset.sourceLine);
        if (Number.isNaN(line)) return;
        const top = el.getBoundingClientRect().top - containerRect.top + previewContainer.scrollTop;
        anchors.push({ line, top });
      });
      anchors.sort((a, b) => a.line - b.line);

      const totalLines = sourceRef.current.split("\n").length;
      const scrollHeight = previewContainer.scrollHeight;
      return [{ line: 0, top: 0 }, ...anchors, { line: totalLines, top: scrollHeight }];
    }

    function handleScroll(event: Event) {
      const editorHandle = editorRef.current;
      const previewHandle = previewRef.current;
      if (!editorHandle || !previewHandle) return;

      // Resolvidos a cada evento (nunca cacheados fora do handler) — é o que
      // torna isto imune a `EditorPane` destruir/recriar seu `EditorView`.
      const editorScrollDOM = editorHandle.getScrollDOM();
      const previewContainer = previewHandle.getContainer();
      const target = event.target;

      if (target === editorScrollDOM) {
        if (syncing === "editor" || !previewContainer) return;
        const line = editorHandle.getTopVisibleLine();
        const targetTop = lineToOffset(getPreviewAnchors(previewContainer), line);
        syncing = "preview";
        previewContainer.scrollTop = targetTop;
        requestAnimationFrame(() => {
          syncing = null;
        });
      } else if (target === previewContainer) {
        if (syncing === "preview" || !previewContainer) return;
        const line = offsetToLine(getPreviewAnchors(previewContainer), previewContainer.scrollTop);
        syncing = "editor";
        editorHandle.scrollToLine(line);
        requestAnimationFrame(() => {
          syncing = null;
        });
      }
    }

    root.addEventListener("scroll", handleScroll, true);
    return () => {
      root.removeEventListener("scroll", handleScroll, true);
    };
  }, [containerRef, editorRef, previewRef, enabled]);
}
