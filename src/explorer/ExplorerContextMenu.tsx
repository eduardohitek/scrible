import { useEffect, useRef } from "react";

export interface ExplorerContextMenuTarget {
  x: number;
  y: number;
  /** `null` = clique em área vazia da árvore; ações de criação usam a raiz
   * do workspace como diretório alvo, e Renomear/Excluir ficam ocultos. */
  path: string | null;
  isDir: boolean;
}

interface ExplorerContextMenuProps {
  target: ExplorerContextMenuTarget;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function ExplorerContextMenu({ target, onClose, onNewFile, onNewFolder, onRename, onDelete }: ExplorerContextMenuProps) {
  const containerRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  function runAndClose(action: () => void) {
    action();
    onClose();
  }

  return (
    <ul className="explorer-context-menu" ref={containerRef} style={{ top: target.y, left: target.x }}>
      <li>
        <button type="button" onClick={() => runAndClose(onNewFile)}>
          Novo arquivo
        </button>
      </li>
      <li>
        <button type="button" onClick={() => runAndClose(onNewFolder)}>
          Nova pasta
        </button>
      </li>
      {target.path !== null && (
        <>
          <li className="explorer-context-menu-separator" role="separator" />
          <li>
            <button type="button" onClick={() => runAndClose(onRename)}>
              Renomear
            </button>
          </li>
          <li>
            <button type="button" onClick={() => runAndClose(onDelete)}>
              Excluir
            </button>
          </li>
        </>
      )}
    </ul>
  );
}
