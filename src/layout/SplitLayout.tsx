import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { EditorPane, type EditorPaneHandle } from "../editor/EditorPane";
import { PreviewPane, type PreviewPaneHandle } from "../preview/PreviewPane";
import { useLayoutStore } from "./layoutStore";
import { clampSplitRatio } from "./constants";
import { useScrollSync } from "./useScrollSync";

interface SplitLayoutProps {
  tabId: string | null;
  source: string;
}

/** API imperativa mínima exposta ao `App.tsx` — hoje só o item "Buscar" do
 * menu nativo (#24) precisa alcançar o editor de fora desta árvore. Mesmo
 * padrão de `EditorPaneHandle`/`PreviewPaneHandle` (#20): não vaza a
 * `EditorView` bruta, só a ação. */
export interface SplitLayoutHandle {
  openSearch(): void;
}

export const SplitLayout = forwardRef<SplitLayoutHandle, SplitLayoutProps>(function SplitLayout(
  { tabId, source },
  ref,
) {
  const splitRatio = useLayoutStore((state) => state.splitRatio);
  const viewMode = useLayoutStore((state) => state.viewMode);
  const setSplitRatio = useLayoutStore((state) => state.setSplitRatio);
  const previewVisible = viewMode !== "editor";
  const editorHidden = viewMode === "preview";

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRatioRef = useRef(splitRatio);
  const [isDragging, setIsDragging] = useState(false);

  const editorRef = useRef<EditorPaneHandle>(null);
  const previewRef = useRef<PreviewPaneHandle>(null);
  useScrollSync(containerRef, editorRef, previewRef, source, previewVisible);

  // Buscar no modo só visualização volta pro lado a lado e só abre o painel
  // depois do render que torna o editor visível de novo (painel aberto num
  // editor `inert` não receberia o foco).
  const pendingSearchRef = useRef(false);
  useImperativeHandle(ref, () => ({
    openSearch: () => {
      if (useLayoutStore.getState().viewMode === "preview") {
        pendingSearchRef.current = true;
        void useLayoutStore.getState().setViewMode("split");
        return;
      }
      editorRef.current?.openSearch();
    },
  }));

  // Saindo do modo só visualização, o foco volta pro editor — quem alterna com
  // ⇧⌘P pra editar não precisa clicar no texto antes de digitar.
  const previousModeRef = useRef(viewMode);
  useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = viewMode;
    if (viewMode === "preview") return;
    if (pendingSearchRef.current) {
      pendingSearchRef.current = false;
      editorRef.current?.openSearch();
    } else if (previousMode === "preview") {
      editorRef.current?.focus();
    }
  }, [viewMode]);

  function handleDividerMouseDown(event: React.MouseEvent) {
    event.preventDefault();
    dragRatioRef.current = splitRatio;
    setIsDragging(true);
  }

  // Durante o arraste, a largura só é atualizada via mutação direta do DOM
  // (custom property CSS), throttled por requestAnimationFrame — setar
  // splitRatio no state do React a cada mousemove re-renderizaria
  // EditorPane/PreviewPane a cada tick, sem necessidade. O commit único
  // (setSplitRatio, que persiste) acontece só no mouseup.
  useEffect(() => {
    if (!isDragging) return;

    let frame: number | null = null;

    function handleMouseMove(event: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      dragRatioRef.current = clampSplitRatio((event.clientX - rect.left) / rect.width, rect.width);
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        container.style.setProperty("--split-ratio", String(dragRatioRef.current));
      });
    }

    function handleMouseUp() {
      setIsDragging(false);
      void setSplitRatio(dragRatioRef.current);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.classList.add("is-resizing");

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("is-resizing");
    };
  }, [isDragging, setSplitRatio]);

  return (
    <div
      className="app-main"
      ref={containerRef}
      style={{ "--split-ratio": splitRatio } as CSSProperties}
    >
      {tabId && <EditorPane ref={editorRef} tabId={tabId} hidden={editorHidden} />}
      {previewVisible && (
        <>
          {!editorHidden && (
            <div
              className="split-divider"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={handleDividerMouseDown}
            />
          )}
          <PreviewPane ref={previewRef} source={source} />
        </>
      )}
      {isDragging && <div className="split-drag-overlay" />}
    </div>
  );
});
