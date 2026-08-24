import { useRef } from "react";
import { useClickOutside } from "../ui/useClickOutside";

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

  useClickOutside(containerRef, onClose, true);

  function runAndClose(action: () => void) {
    action();
    onClose();
  }

  return (
    <ul
      className="popover-surface explorer-context-menu"
      ref={containerRef}
      style={{ top: target.y, left: target.x }}
    >
      <li>
        <button type="button" className="popover-menu-item" onClick={() => runAndClose(onNewFile)}>
          Novo arquivo
        </button>
      </li>
      <li>
        <button type="button" className="popover-menu-item" onClick={() => runAndClose(onNewFolder)}>
          Nova pasta
        </button>
      </li>
      {target.path !== null && (
        <>
          <li className="explorer-context-menu-separator" role="separator" />
          <li>
            <button type="button" className="popover-menu-item" onClick={() => runAndClose(onRename)}>
              Renomear
            </button>
          </li>
          <li>
            <button type="button" className="popover-menu-item" onClick={() => runAndClose(onDelete)}>
              Excluir
            </button>
          </li>
        </>
      )}
    </ul>
  );
}
