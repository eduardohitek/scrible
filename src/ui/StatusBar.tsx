import { useMemo } from "react";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore } from "../store/documentStore";

function countWordsAndChars(content: string): { words: number; chars: number } {
  const trimmed = content.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  return { words, chars: content.length };
}

/** Substitui o `.save-indicator` intermitente (só aparecia durante
 * `status === "saving"`) por uma barra sempre presente — resolve a
 * ansiedade de "será que gravou?" que autosave silencioso sempre gera. */
export function StatusBar() {
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const activeDoc = useDocumentStore((state) => (activeTabId ? state.documents[activeTabId] : undefined));

  const { words, chars } = useMemo(() => countWordsAndChars(activeDoc?.content ?? ""), [activeDoc?.content]);

  const saveState = !activeDoc
    ? null
    : activeDoc.status === "saving"
      ? "Salvando…"
      : activeDoc.dirty
        ? "Não salvo"
        : "Salvo";

  return (
    <div className="status-bar">
      <span className="status-bar-counts">
        {words} {words === 1 ? "palavra" : "palavras"} · {chars} {chars === 1 ? "caractere" : "caracteres"}
      </span>
      {saveState && <span className="status-bar-save-state">{saveState}</span>}
    </div>
  );
}
