import { PanelLeft, Search, Columns2, Eye, PenLine, EyeOff, type LucideIcon } from "lucide-react";
import { runCommand, getCommand } from "../commands/registry";
import { useExplorerStore } from "../explorer/explorerStore";
import { useLayoutStore, VIEW_MODE_LABEL, type ViewMode } from "../layout/layoutStore";
import { useLivePreviewStore } from "../editor/livePreviewStore";
import { ThemeToggle } from "../theme/ThemeToggle";
import { HistoryPanel } from "../history/HistoryPanel";
import { ExportMenu } from "../export/ExportMenu";

/** Grupo de ícones à direita da barra do topo — consolida os cinco
 * elementos que antes flutuavam nos quatro cantos + borda esquerda de
 * `.app-shell-content` (ver DECISIONS.md #60). Os três primeiros botões só
 * disparam `runCommand`; os dois últimos (histórico e exportar) e o de tema
 * têm popover próprio, então continuam como componentes dedicados. */
const VIEW_MODE_ICON: Record<ViewMode, LucideIcon> = {
  editor: PenLine,
  split: Columns2,
  preview: Eye,
};

export function Toolbar() {
  const explorerVisible = useExplorerStore((state) => state.visible);
  const viewMode = useLayoutStore((state) => state.viewMode);
  const hideMarkers = useLivePreviewStore((state) => state.hideMarkers);
  const ViewModeIcon = VIEW_MODE_ICON[viewMode];

  const findShortcut = getCommand("find")?.shortcut;
  const toggleExplorerShortcut = getCommand("toggle_explorer")?.shortcut;
  const cycleViewModeShortcut = getCommand("cycle_view_mode")?.shortcut;

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
        aria-label={`Modo de exibição: ${VIEW_MODE_LABEL[viewMode]}`}
        data-tooltip={`${VIEW_MODE_LABEL[viewMode]} — ${cycleViewModeShortcut} alterna`}
        onClick={() => runCommand("cycle_view_mode")}
      >
        <ViewModeIcon size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Ocultar marcadores markdown"
        aria-pressed={hideMarkers}
        data-tooltip={hideMarkers ? "Marcadores ocultos fora da linha do cursor" : "Ocultar marcadores fora da linha do cursor"}
        onClick={() => runCommand("toggle_hide_markers")}
      >
        <EyeOff size={16} aria-hidden="true" />
      </button>
      <HistoryPanel />
      <div className="toolbar-separator" role="separator" aria-orientation="vertical" />
      <ExportMenu />
      <ThemeToggle />
    </div>
  );
}
