import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { useTabsStore } from "../store/tabsStore";
import { useExplorerStore, type ExplorerEntry } from "./explorerStore";
import { ExplorerContextMenu, type ExplorerContextMenuTarget } from "./ExplorerContextMenu";
import { clampExplorerWidth } from "./constants";

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

interface ExplorerNodeProps {
  path: string;
  entry: ExplorerEntry;
  depth: number;
  renamingPath: string | null;
  onContextMenu: (event: MouseEvent, path: string, isDir: boolean) => void;
  onCommitRename: (path: string, newName: string, isDir: boolean) => void;
  onCancelRename: () => void;
}

function ExplorerNode({ path, entry, depth, renamingPath, onContextMenu, onCommitRename, onCancelRename }: ExplorerNodeProps) {
  const expanded = useExplorerStore((state) => state.expandedDirs.has(path));
  const children = useExplorerStore((state) => state.entriesByDir[path]);
  const toggleDir = useExplorerStore((state) => state.toggleDir);
  const openTab = useTabsStore((state) => state.openTab);

  const isRenaming = renamingPath === path;

  function handleClick() {
    if (entry.isDir) void toggleDir(path);
    else void openTab(path);
  }

  function handleEditingKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") onCommitRename(path, event.currentTarget.value, entry.isDir);
    else if (event.key === "Escape") onCancelRename();
  }

  return (
    <div className="explorer-node">
      <div
        className="explorer-node-row"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(event) => onContextMenu(event, path, entry.isDir)}
      >
        {entry.isDir && <span className="explorer-node-chevron">{expanded ? "▾" : "▸"}</span>}
        {isRenaming ? (
          <input
            className="explorer-node-rename-input"
            autoFocus
            defaultValue={entry.name}
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => onCommitRename(path, event.currentTarget.value, entry.isDir)}
            onKeyDown={handleEditingKeyDown}
          />
        ) : (
          <span className="explorer-node-name">{entry.name}</span>
        )}
      </div>
      {entry.isDir && expanded && (
        <div className="explorer-node-children">
          {(children ?? []).map((child) => (
            <ExplorerNode
              key={child.name}
              path={`${path}/${child.name}`}
              entry={child}
              depth={depth + 1}
              renamingPath={renamingPath}
              onContextMenu={onContextMenu}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplorerPanel() {
  const workspaceRoot = useExplorerStore((state) => state.workspaceRoot);
  const visible = useExplorerStore((state) => state.visible);
  const width = useExplorerStore((state) => state.width);
  const rootEntries = useExplorerStore((state) => (state.workspaceRoot ? state.entriesByDir[state.workspaceRoot] : undefined));
  const setWidth = useExplorerStore((state) => state.setWidth);
  const createFile = useExplorerStore((state) => state.createFile);
  const createFolder = useExplorerStore((state) => state.createFolder);
  const renameEntry = useExplorerStore((state) => state.renameEntry);
  const deleteEntry = useExplorerStore((state) => state.deleteEntry);

  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuTarget | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragWidthRef = useRef(width);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;

    let frame: number | null = null;

    function handleMouseMove(event: globalThis.MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      dragWidthRef.current = clampExplorerWidth(event.clientX - rect.left);
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        container.style.setProperty("--explorer-width", `${dragWidthRef.current}px`);
      });
    }

    function handleMouseUp() {
      setIsDragging(false);
      void setWidth(dragWidthRef.current);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.classList.add("is-resizing");

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("is-resizing");
    };
  }, [isDragging, setWidth]);

  if (!visible || !workspaceRoot) return null;

  function openContextMenu(event: MouseEvent, path: string | null, isDir: boolean) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, path, isDir });
  }

  function targetDirFor(target: ExplorerContextMenuTarget): string {
    if (target.path === null) return workspaceRoot!;
    return target.isDir ? target.path : dirname(target.path);
  }

  function handleCommitRename(path: string, newName: string, isDir: boolean) {
    setRenamingPath(null);
    const trimmed = newName.trim();
    if (trimmed && trimmed !== path.split("/").pop()) void renameEntry(path, trimmed, isDir);
  }

  return (
    <div
      className="explorer-panel"
      ref={containerRef}
      style={{ "--explorer-width": `${width}px` } as CSSProperties}
      onContextMenu={(event) => openContextMenu(event, null, true)}
    >
      <div className="explorer-tree">
        {(rootEntries ?? []).map((entry) => (
          <ExplorerNode
            key={entry.name}
            path={`${workspaceRoot}/${entry.name}`}
            entry={entry}
            depth={0}
            renamingPath={renamingPath}
            onContextMenu={openContextMenu}
            onCommitRename={handleCommitRename}
            onCancelRename={() => setRenamingPath(null)}
          />
        ))}
      </div>
      <div
        className="explorer-resize-handle"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={(event) => {
          event.preventDefault();
          dragWidthRef.current = width;
          setIsDragging(true);
        }}
      />
      {contextMenu && (
        <ExplorerContextMenu
          target={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={() => void createFile(targetDirFor(contextMenu))}
          onNewFolder={() => void createFolder(targetDirFor(contextMenu))}
          onRename={() => contextMenu.path && setRenamingPath(contextMenu.path)}
          onDelete={() => contextMenu.path && void deleteEntry(contextMenu.path, contextMenu.isDir)}
        />
      )}
    </div>
  );
}
