import { useDocumentStore } from "../store/documentStore";
import { useTabsStore } from "../store/tabsStore";

/** Aba cujo arquivo foi apagado, renomeado ou movido por outro programa
 * (#141). O autosave fica suspenso até o usuário escolher. */
export function MissingFileBanner() {
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const closeTab = useTabsStore((state) => state.closeTab);
  const restoreMissing = useDocumentStore((state) => state.restoreMissing);

  return (
    <div className="conflict-banner" role="alert">
      <span>Arquivo removido do disco. As alterações não estão sendo salvas.</span>
      <div className="conflict-banner-actions">
        <button type="button" onClick={() => activeTabId && void restoreMissing(activeTabId)}>
          Salvar de novo aqui
        </button>
        <button type="button" onClick={() => activeTabId && void closeTab(activeTabId, { skipFlush: true })}>
          Fechar aba
        </button>
      </div>
    </div>
  );
}
