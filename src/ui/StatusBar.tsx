import { useEffect, useMemo, useState } from "react";
import { useTabsStore } from "../store/tabsStore";
import { useDocumentStore } from "../store/documentStore";
import { useZoomStore } from "../zoom/zoomStore";

export const RELOAD_MESSAGE_MS = 3000;

/** "Recarregado do disco" (#142): aparece quando a aba ativa recarrega
 * sozinha por alteração externa. O sinal vem de `lastExternalReload`, que só
 * o caminho de reload de `handleExternalChange` preenche, e não do evento do
 * watcher. Reload de aba em segundo plano não mostra nada. A mensagem some
 * depois de `RELOAD_MESSAGE_MS` ou na hora em que a aba ativa muda. */
function useReloadMessage(activeTabId: string | null): boolean {
  const [reloadedTabId, setReloadedTabId] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useDocumentStore.subscribe((state, prev) => {
      const reload = state.lastExternalReload;
      if (!reload || reload === prev.lastExternalReload) return;
      if (reload.tabId !== useTabsStore.getState().activeTabId) return;
      clearTimeout(timer);
      setReloadedTabId(reload.tabId);
      timer = setTimeout(() => setReloadedTabId(null), RELOAD_MESSAGE_MS);
    });
    // Trocar de aba descarta a mensagem: voltar para a aba dentro dos 3s não
    // a mostra de novo.
    const unsubscribeTabs = useTabsStore.subscribe((state, prev) => {
      if (state.activeTabId === prev.activeTabId) return;
      clearTimeout(timer);
      setReloadedTabId(null);
    });
    return () => {
      unsubscribe();
      unsubscribeTabs();
      clearTimeout(timer);
    };
  }, []);

  return reloadedTabId !== null && reloadedTabId === activeTabId;
}

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
  const zoom = useZoomStore((state) => state.zoom);
  const showReloaded = useReloadMessage(activeTabId);

  const { words, chars } = useMemo(() => countWordsAndChars(activeDoc?.content ?? ""), [activeDoc?.content]);

  const saveState = !activeDoc
    ? null
    : activeDoc.status === "missing"
      ? ({ key: "dirty", label: "Removido do disco" } as const)
      : activeDoc.status === "saving"
        ? ({ key: "saving", label: "Salvando…" } as const)
        : activeDoc.dirty
          ? ({ key: "dirty", label: "Não salvo" } as const)
          : showReloaded
            ? ({ key: "saved", label: "Recarregado do disco" } as const)
            : ({ key: "saved", label: "Salvo" } as const);

  return (
    <div className="status-bar">
      <span className="status-bar-counts">
        {words} {words === 1 ? "palavra" : "palavras"} · {chars} {chars === 1 ? "caractere" : "caracteres"}
      </span>
      <span className="status-bar-right">
        {zoom !== 1 && <span className="status-bar-zoom">{Math.round(zoom * 100)}%</span>}
        {saveState && (
          <span className="status-bar-save-state" data-state={saveState.key}>
            <span className="status-bar-save-dot" aria-hidden="true" />
            <span>{saveState.label}</span>
          </span>
        )}
      </span>
    </div>
  );
}
