import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { homeDir } from "@tauri-apps/api/path";
import { ChevronDown, Plus, TriangleAlert, X } from "lucide-react";
import { useTabsStore, type Tab } from "../store/tabsStore";
import { useDocumentStore } from "../store/documentStore";

/** Pasta da aba para a lista: o home vira `~`. Compara até a `/` para não
 * abreviar uma pasta vizinha (`/Users/ana2` com home `/Users/ana`). */
function displayFolder(path: string, home: string | null): string {
  const folder = path.slice(0, path.lastIndexOf("/")) || "/";
  if (home && (folder === home || folder.startsWith(`${home}/`))) {
    return `~${folder.slice(home.length)}`;
  }
  return folder;
}

/** Aviso de alteração externa na aba (#142): conflito (#10) ou arquivo
 * removido (#141). Devolve o texto do `title`, ou `null` se não há aviso. */
function useTabWarning(tabId: string): string | null {
  return useDocumentStore((state) => {
    const status = state.documents[tabId]?.status;
    if (status === "conflict") return "Conflito: o arquivo foi alterado por outro programa";
    if (status === "missing") return "Arquivo removido do disco";
    return null;
  });
}

function TabWarning({ title }: { title: string }) {
  return (
    <span className="tab-warning" title={title} aria-label={title} role="img">
      <TriangleAlert size={13} aria-hidden="true" />
    </span>
  );
}

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
  const warning = useTabWarning(tab.id);

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
      data-tab-id={tab.id}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(index)}
      onClick={() => onSelect(tab.id)}
    >
      {warning && <TabWarning title={warning} />}
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

function TabListItem({
  tab,
  active,
  home,
  select,
}: {
  tab: Tab;
  active: boolean;
  home: string | null;
  select: () => void;
}) {
  const dirty = useDocumentStore((state) => state.documents[tab.id]?.dirty ?? false);
  const warning = useTabWarning(tab.id);
  return (
    <button
      type="button"
      className="tab-list-item"
      aria-current={active ? "page" : undefined}
      onClick={select}
    >
      <span>
        {active ? "✓ " : ""}
        {warning && <TabWarning title={warning} />}
        {tab.title}
        {dirty ? " •" : ""}
      </span>
      <small>{displayFolder(tab.path, home)}</small>
    </button>
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

  const barRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [home, setHome] = useState<string | null>(null);

  // Busca ao surgir o botão, não ao abrir a lista, para o caminho completo não
  // aparecer antes do `~`. Se falhar, a lista mostra o caminho completo.
  useEffect(() => {
    if (!overflow || home) return;
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, [overflow, home]);

  useLayoutEffect(() => {
    const bar = barRef.current!;
    const update = () => {
      const overflowing = bar.scrollWidth > bar.clientWidth;
      setOverflow(overflowing);
      if (!overflowing) setListOpen(false);
      const active = Array.from(bar.querySelectorAll<HTMLElement>("[data-tab-id]")).find(
        (item) => item.dataset.tabId === activeTabId,
      );
      if (active) {
        const bounds = bar.getBoundingClientRect();
        const item = active.getBoundingClientRect();
        if (item.left < bounds.left) bar.scrollLeft -= bounds.left - item.left;
        else if (item.right > bounds.right) bar.scrollLeft += item.right - bounds.right;
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    Array.from(bar.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [tabs, activeTabId]);

  useEffect(() => {
    const bar = barRef.current!;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || bar.scrollWidth <= bar.clientWidth)
        return;
      event.preventDefault();
      bar.scrollLeft +=
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bar.clientWidth : 1);
    };
    bar.addEventListener("wheel", wheel, { passive: false });
    return () => bar.removeEventListener("wheel", wheel);
  }, []);

  useEffect(() => {
    if (!listOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (
        !target.closest('.tab-list, [aria-label="Todas as abas"]') ||
        !containerRef.current?.contains(target)
      )
        setListOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setListOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [listOpen]);

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
    <div className="tab-bar-container" ref={containerRef}>
      <div className="tab-bar" ref={barRef}>
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
        <button
          type="button"
          className="tab-new"
          aria-label="Nova aba"
          onClick={() => void newTab()}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {overflow && (
        <button
          type="button"
          className="tab-new"
          aria-label="Todas as abas"
          aria-expanded={listOpen}
          onClick={() => setListOpen(!listOpen)}
        >
          <ChevronDown size={16} />
        </button>
      )}
      {overflow && listOpen && (
        <div className="tab-list" aria-label="Abas abertas">
          {tabs.map((tab) => (
            <TabListItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              home={home}
              select={() => {
                setActiveTab(tab.id);
                setListOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
