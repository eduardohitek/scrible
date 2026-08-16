import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";

interface EditorPaneProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Montagem mínima do CodeMirror 6 para provar o pipeline do scaffold:
 * edição de markdown com soft wrap, sem numeração de linha (não é um
 * editor de código). Decorations de preview inline, autocomplete e
 * atalhos avançados chegam nas issues dedicadas do editor.
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
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
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

  return <div className="editor-pane" ref={containerRef} />;
}
