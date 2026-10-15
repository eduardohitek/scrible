import { useState, type DragEvent, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { useTabsStore, type Tab } from "../store/tabsStore";
import { useDocumentStore } from "../store/documentStore";

interface TabItemProps {
  tab: Tab;
  index: number;
  isActive: boolean;
  isEditing: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (index: number) => void;
  onSelect: (tabId: string) => void;
  onStartRenaming: (tabId: string) => void;
  onCommitRenaming: (tabId: string, value: string) => void;
  onCancelRenaming: () => void;
  onClose: (tabId: string) => void;
}

/** Componente por aba — assina `dirty` individualmente (mesma técnica de
 * assinatura por item que `ExplorerNode` já usa em `ExplorerPanel.tsx`), pra
 * digitar numa aba não re-renderizar a barra inteira. */
function TabItem({
  tab,
  index,
  isActive,
  isEditing,
  onDragStart,
  onDragOver,
  onDrop,
  onSelect,
  onStartRenaming,
  onCommitRenaming,
  onCancelRenaming,
  onClose,
}: TabItemProps) {
  const dirty = useDocumentStore((state) => state.documents[tab.id]?.dirty ?? false);

  function handleEditingKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      onCommitRenaming(tab.id, event.currentTarget.value);
    } else if (event.key === "Escape") {
      onCancelRenaming();
    }
  }

  return (
    <div
      className={isActive ? "tab tab-active" : "tab"}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(index)}
      onClick={() => onSelect(tab.id)}
    >
      {isEditing ? (
        <input
          className="tab-title-input"
          autoFocus
          defaultValue={tab.title}
          onBlur={(event) => onCommitRenaming(tab.id, event.currentTarget.value)}
          onKeyDown={handleEditingKeyDown}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <span className="tab-title" onDoubleClick={() => onStartRenaming(tab.id)}>
          {tab.title}
        </span>
      )}
      <button
        type="button"
        className="tab-close"
        aria-label={`Fechar ${tab.title}`}
        data-dirty={dirty}
        onClick={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
      >
        <X className="tab-close-icon" size={14} aria-hidden="true" />
        <span className="tab-dirty-dot" aria-hidden="true" />
      </button>
    </div>
  );
}

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

  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => (
        <TabItem
          key={tab.id}
          tab={tab}
          index={index}
          isActive={tab.id === activeTabId}
          isEditing={editingTabId === tab.id}
          onDragStart={setDraggedIndex}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onSelect={setActiveTab}
          onStartRenaming={startRenaming}
          onCommitRenaming={(tabId, value) => void commitRenaming(tabId, value)}
          onCancelRenaming={cancelRenaming}
          onClose={(tabId) => void closeTab(tabId)}
        />
      ))}
      <button type="button" className="tab-new" aria-label="Nova aba" onClick={() => void newTab()}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
