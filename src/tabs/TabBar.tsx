import { useState, type DragEvent, type KeyboardEvent } from "react";
import { useTabsStore } from "../store/tabsStore";

export function TabBar() {
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const reorderTabs = useTabsStore((state) => state.reorderTabs);
  const renameTab = useTabsStore((state) => state.renameTab);
  const newTab = useTabsStore((state) => state.newTab);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

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

  function startEditing(tabId: string, currentTitle: string) {
    setEditingTabId(tabId);
    setDraftTitle(currentTitle);
  }

  function commitEditing(tabId: string) {
    const title = draftTitle.trim();
    setEditingTabId(null);
    if (title) void renameTab(tabId, title);
  }

  function handleEditingKeyDown(event: KeyboardEvent<HTMLInputElement>, tabId: string) {
    if (event.key === "Enter") {
      commitEditing(tabId);
    } else if (event.key === "Escape") {
      setEditingTabId(null);
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
            <input
              className="tab-title-input"
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => commitEditing(tab.id)}
              onKeyDown={(event) => handleEditingKeyDown(event, tab.id)}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="tab-title" onDoubleClick={() => startEditing(tab.id, tab.title)}>
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
