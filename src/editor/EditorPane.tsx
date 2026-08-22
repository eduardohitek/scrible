import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { useDocumentStore } from "../store/documentStore";
import { getOrCreateEditorState, getScrollTop, saveEditorState, saveScrollTop } from "./editorStateRegistry";

interface EditorPaneProps {
  tabId: string;
}

/** API imperativa mínima para o sync de scroll (#20) orquestrar o editor
 * a partir de `SplitLayout`/`useScrollSync`, sem expor o `EditorView` bruto. */
export interface EditorPaneHandle {
  getScrollDOM(): HTMLElement | null;
  /** Linha visível no topo do editor, 0-indexada (mesma unidade de
   * `token.map` do markdown-it) e fracionária — a parte fracionária é a
   * posição relativa dentro da linha. */
  getTopVisibleLine(): number;
  /** Rola o editor até a linha (0-indexada, fracionária) informada. */
  scrollToLine(line: number): void;
  /** Abre o painel de busca/substituição (#16), disparado pelo item "Buscar"
   * do menu nativo (#24) — Cmd+F em si vira exclusividade do menu, ver
   * `useTabShortcuts.ts`. */
  openSearch(): void;
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
export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane({ tabId }, ref) {
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
      // Sem isto, o StrictMode do React 18 (mount -> cleanup -> mount, só em
      // dev) deixa `viewRef.current` apontando pra uma EditorView já
      // destruída: o efeito de montagem, ao rodar de novo, vê a ref não-nula
      // e cai no ramo de `setState()` num view morto em vez de criar um novo
      // — o editor fica sem nenhuma EditorView viva (sem carregar conteúdo,
      // sem aceitar digitação) só em `mise run dev`.
      viewRef.current = null;
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

  useImperativeHandle(
    ref,
    () => ({
      getScrollDOM: () => viewRef.current?.scrollDOM ?? null,
      getTopVisibleLine: () => {
        const view = viewRef.current;
        if (!view) return 0;
        const scrollTop = view.scrollDOM.scrollTop;
        const block = view.lineBlockAtHeight(scrollTop);
        const docLine = view.state.doc.lineAt(block.from);
        const fraction = block.height > 0 ? (scrollTop - block.top) / block.height : 0;
        return docLine.number - 1 + fraction;
      },
      scrollToLine: (line) => {
        const view = viewRef.current;
        if (!view) return;
        const lineNumber = Math.min(Math.max(Math.floor(line) + 1, 1), view.state.doc.lines);
        const docLine = view.state.doc.line(lineNumber);
        const block = view.lineBlockAt(docLine.from);
        const fraction = line - Math.floor(line);
        view.scrollDOM.scrollTop = block.top + fraction * block.height;
      },
      openSearch: () => {
        const view = viewRef.current;
        if (view) openSearchPanel(view);
      },
    }),
    [],
  );

  return <div className="editor-pane" ref={containerRef} />;
});
