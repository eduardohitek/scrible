import { useEffect, useRef } from "react";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { markdownDecorations } from "./markdownDecorations";

interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Montagem do CodeMirror 6: edição de markdown com soft wrap, sem
 * numeração de linha (não é um editor de código), com decorations de
 * preview inline nível 2 (#12). Autocomplete e atalhos avançados chegam
 * nas issues dedicadas do editor.
 */
export function EditorPane({ value, onChange }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown(),
        markdownDecorations(),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          // Transações sem userEvent são sincronizações programáticas (ver
          // efeito de `value` abaixo) — só ecoa pro store mudanças que o
          // próprio usuário causou (digitação, paste, undo/redo, comandos).
          const isUserChange = update.transactions.some((tr) => tr.annotation(Transaction.userEvent) !== undefined);
          if (isUserChange) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monta uma vez; troca de aba recria o componente
  }, []);

  // Resincroniza o doc do CodeMirror quando `value` muda por fora da
  // digitação (load inicial assíncrono, restauração de histórico, reload
  // silencioso do watcher) — o efeito acima só grava o doc inicial.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === view.state.doc.toString()) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="editor-pane" ref={containerRef} />;
}
