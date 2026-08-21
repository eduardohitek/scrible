import { useDocumentStore } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

export function ConflictBanner() {
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const resolveConflict = useDocumentStore((state) => state.resolveConflict);

  return (
    <div className="conflict-banner">
      <span>Este arquivo foi alterado por outro programa.</span>
      <div className="conflict-banner-actions">
        <button type="button" onClick={() => activeTabId && void resolveConflict(activeTabId, "mine")}>
          Manter minha versão
        </button>
        <button type="button" onClick={() => activeTabId && void resolveConflict(activeTabId, "disk")}>
          Usar versão do disco
        </button>
      </div>
    </div>
  );
}
