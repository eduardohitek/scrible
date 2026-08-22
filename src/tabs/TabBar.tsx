import { useState, type DragEvent, type KeyboardEvent } from "react";
import { useTabsStore } from "../store/tabsStore";

export function TabBar() {
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const reorderTabs = useTabsStore((state) => state.reorderTabs);
  const newTab = useTabsStore((state) => state.newTab);
  const editingTabId = useTabsStore((state) => state.editingTabId);
  const startRenaming = useTabsStore((state) => state.startRenaming);
  const cancelRenaming = useTabsStore((state) => state.cancelRenaming);
  const commitRenaming = useTabsStore((state) => state.commitRenaming);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // Obrigatório: sem preventDefault() o navegador recusa o drop.
    event.preventDefault();
  }

  function handleDrop(index: number) {
    if (draggedIndex !== null && draggedIndex !== index) {
      reorderTabs(draggedIndex, index);
    }
    setDraggedIndex(null);
  }

  function handleEditingKeyDown(event: KeyboardEvent<HTMLInputElement>, tabId: string) {
    if (event.key === "Enter") {
      void commitRenaming(tabId, event.currentTarget.value);
    } else if (event.key === "Escape") {
      cancelRenaming();
    }
  }

  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={tab.id === activeTabId ? "tab tab-active" : "tab"}
          draggable
          onDragStart={() => setDraggedIndex(index)}
          onDragOver={handleDragOver}
          onDrop={() => handleDrop(index)}
          onClick={() => setActiveTab(tab.id)}
        >
          {editingTabId === tab.id ? (
            // Não-controlado (defaultValue, não value) — evita precisar de um
            // `useState` de rascunho inicializado via efeito só pra cobrir o
            // gatilho externo do menu nativo (#24, `startRenaming` chamado de
            // fora desta árvore). Remonta com o título atual sempre que o
            // input aparece, porque a alternância span/input já monta uma
            // instância nova a cada vez.
            <input
              className="tab-title-input"
              autoFocus
              defaultValue={tab.title}
              onBlur={(event) => void commitRenaming(tab.id, event.currentTarget.value)}
              onKeyDown={(event) => handleEditingKeyDown(event, tab.id)}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="tab-title" onDoubleClick={() => startRenaming(tab.id)}>
              {tab.title}
            </span>
          )}
          <button
            type="button"
            className="tab-close"
            aria-label={`Fechar ${tab.title}`}
            onClick={(event) => {
              event.stopPropagation();
              void closeTab(tab.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="tab-new" aria-label="Nova aba" onClick={() => void newTab()}>
        +
      </button>
    </div>
  );
}
