import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { useDocumentStore } from "../store/documentStore";
import { getOrCreateEditorState, getScrollTop, saveEditorState, saveScrollTop } from "./editorStateRegistry";

interface EditorPaneProps {
  tabId: string;
}

/**
 * Montagem do CodeMirror 6: edição de markdown com soft wrap, sem
 * numeração de linha (não é um editor de código), com decorations de
 * preview inline nível 2 (#12) e comportamentos automáticos de
 * digitação (#13) e menu de comandos com `/` (#14). Autocomplete de
 * linguagem/snippets mermaid em fences chega na issue dedicada (#15).
 *
 * Um único `EditorView` é compartilhado entre todas as abas (#21): trocar
 * de aba não remonta o componente, só troca o `EditorState` via
 * `view.setState`, preservando undo/redo e seleção por aba (ver
 * `editorStateRegistry.ts`).
 */
export function EditorPane({ tabId }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const mountedTabIdRef = useRef<string | null>(null);

  const content = useDocumentStore((state) => state.documents[tabId]?.content ?? "");
  const setContent = useDocumentStore((state) => state.setContent);

  useEffect(() => {
    if (!containerRef.current) return;

    const onChange = (value: string) => setContent(tabId, value);
    const state = getOrCreateEditorState(tabId, content, onChange);

    if (!viewRef.current) {
      viewRef.current = new EditorView({ state, parent: containerRef.current });
    } else {
      const previousTabId = mountedTabIdRef.current;
      if (previousTabId && previousTabId !== tabId) {
        saveEditorState(previousTabId, viewRef.current.state);
        saveScrollTop(previousTabId, viewRef.current.scrollDOM.scrollTop);
      }
      viewRef.current.setState(state);
    }
    mountedTabIdRef.current = tabId;
    viewRef.current.scrollDOM.scrollTop = getScrollTop(tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a troca de aba dispara isto; conteúdo é resincronizado no efeito abaixo
  }, [tabId]);

  useEffect(() => {
    return () => {
      const view = viewRef.current;
      const tabIdAtUnmount = mountedTabIdRef.current;
      if (view && tabIdAtUnmount) {
        saveEditorState(tabIdAtUnmount, view.state);
        saveScrollTop(tabIdAtUnmount, view.scrollDOM.scrollTop);
      }
      view?.destroy();
    };
  }, []);

  // Resincroniza o doc do CodeMirror quando `content` muda por fora da
  // digitação (restauração de histórico, reload silencioso do watcher,
  // resolução de conflito) — só se aplica à aba atualmente montada no
  // EditorView, nunca a uma aba em segundo plano (essa é reconciliada em
  // getOrCreateEditorState na hora em que for focada).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || mountedTabIdRef.current !== tabId) return;
    if (content === view.state.doc.toString()) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, [content, tabId]);

  return <div className="editor-pane" ref={containerRef} />;
}
