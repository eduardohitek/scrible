import { PanelLeft, Search, Columns2 } from "lucide-react";
import { runCommand, getCommand } from "../commands/registry";
import { useExplorerStore } from "../explorer/explorerStore";
import { useLayoutStore } from "../layout/layoutStore";
import { ThemeToggle } from "../theme/ThemeToggle";
import { HistoryPanel } from "../history/HistoryPanel";
import { ExportMenu } from "../export/ExportMenu";

/** Grupo de ícones à direita da barra do topo — consolida os cinco
 * elementos que antes flutuavam nos quatro cantos + borda esquerda de
 * `.app-shell-content` (ver DECISIONS.md #60). Os três primeiros botões só
 * disparam `runCommand`; os dois últimos (histórico e exportar) e o de tema
 * têm popover próprio, então continuam como componentes dedicados. */
export function Toolbar() {
  const explorerVisible = useExplorerStore((state) => state.visible);
  const previewVisible = useLayoutStore((state) => state.previewVisible);

  const findShortcut = getCommand("find")?.shortcut;
  const toggleExplorerShortcut = getCommand("toggle_explorer")?.shortcut;
  const togglePreviewShortcut = getCommand("toggle_preview")?.shortcut;

  return (
    <div className="toolbar">
      <button
        type="button"
        className="icon-button"
        aria-label="Alternar explorador"
        aria-pressed={explorerVisible}
        data-tooltip={`Alternar explorador — ${toggleExplorerShortcut}`}
        onClick={() => runCommand("toggle_explorer")}
      >
        <PanelLeft size={16} aria-hidden="true" />
      </button>
      <div className="toolbar-separator" role="separator" aria-orientation="vertical" />
      <button
        type="button"
        className="icon-button"
        aria-label="Buscar"
        data-tooltip={`Buscar — ${findShortcut}`}
        onClick={() => runCommand("find")}
      >
        <Search size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Alternar preview"
        aria-pressed={previewVisible}
        data-tooltip={`Alternar preview — ${togglePreviewShortcut}`}
        onClick={() => runCommand("toggle_preview")}
      >
        <Columns2 size={16} aria-hidden="true" />
      </button>
      <HistoryPanel />
      <div className="toolbar-separator" role="separator" aria-orientation="vertical" />
      <ExportMenu />
      <ThemeToggle />
    </div>
  );
}
