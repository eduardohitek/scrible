import { useLayoutStore } from "../layout/layoutStore";
import { useExplorerStore } from "../explorer/explorerStore";
import { useThemeStore, type ThemePreference } from "../theme/themeStore";
import { useTabsStore } from "../store/tabsStore";
import { useZoomStore } from "../zoom/zoomStore";
import { useLivePreviewStore } from "../editor/livePreviewStore";
import { useUpdateStore } from "../updater/updateStore";
import { formatShortcut } from "../platform/platform";
import { exportActiveTabAsHtml, exportActiveTabAsPdf } from "../export/exportHtml";

/** Ponte imperativa para ações que só existem dentro da árvore React (hoje,
 * só abrir a busca do CodeMirror — `SplitLayoutHandle.openSearch()`).
 * `App.tsx` instala essa ponte num `useEffect` e a anula no cleanup — mesma
 * regra de "efeito que cria/destrói recurso imperativo fora do React precisa
 * anular a ref no cleanup" registrada em DECISIONS.md #21, o que também
 * torna StrictMode seguro (dois mount/unmount não deixam ponte órfã). */
export interface EditorBridge {
  openSearch: () => void;
}

let editorBridge: EditorBridge | null = null;

export function setEditorBridge(bridge: EditorBridge | null): void {
  editorBridge = bridge;
}

export interface AppCommand {
  id: string;
  /** pt-BR — mesmo idioma do resto da UI. */
  label: string;
  /** Só exibição (tooltip) — o atalho real, quando existe, é o item do menu
   * nativo (DECISIONS.md #24: nunca registrar um listener JS para uma tecla
   * que já tem accelerator nativo, ele nunca seria alcançado). */
  shortcut?: string;
  run: () => void | Promise<void>;
  isActive?: () => boolean;
}

const THEME_PREFERENCE: Record<string, ThemePreference> = {
  theme_system: "system",
  theme_light: "light",
  theme_dark: "dark",
};

export const commands: readonly AppCommand[] = [
  {
    id: "new_tab",
    label: "Nova aba",
    shortcut: formatShortcut("⌘T"),
    run: () => useTabsStore.getState().newTab(),
  },
  {
    id: "open_file",
    label: "Abrir arquivo…",
    shortcut: formatShortcut("⌘O"),
    run: () => useTabsStore.getState().openFileDialog(),
  },
  {
    id: "close_tab",
    label: "Fechar aba",
    shortcut: formatShortcut("⌘W"),
    run: () => {
      const { activeTabId, closeTab } = useTabsStore.getState();
      if (activeTabId) void closeTab(activeTabId);
    },
  },
  {
    id: "rename_tab",
    label: "Renomear",
    run: () => {
      const { activeTabId, startRenaming } = useTabsStore.getState();
      if (activeTabId) startRenaming(activeTabId);
    },
  },
  {
    id: "find",
    label: "Buscar",
    shortcut: formatShortcut("⌘F"),
    run: () => editorBridge?.openSearch(),
  },
  {
    id: "cycle_view_mode",
    label: "Alternar modo de exibição",
    shortcut: formatShortcut("⇧⌘P"),
    run: () => useLayoutStore.getState().cycleViewMode(),
  },
  {
    id: "view_editor",
    label: "Editor",
    run: () => useLayoutStore.getState().setViewMode("editor"),
    isActive: () => useLayoutStore.getState().viewMode === "editor",
  },
  {
    id: "view_split",
    label: "Lado a lado",
    run: () => useLayoutStore.getState().setViewMode("split"),
    isActive: () => useLayoutStore.getState().viewMode === "split",
  },
  {
    id: "view_preview",
    label: "Visualização",
    run: () => useLayoutStore.getState().setViewMode("preview"),
    isActive: () => useLayoutStore.getState().viewMode === "preview",
  },
  {
    id: "toggle_explorer",
    label: "Alternar explorador",
    shortcut: formatShortcut("⇧⌘E"),
    run: () => useExplorerStore.getState().toggle(),
    isActive: () => useExplorerStore.getState().visible,
  },
  {
    id: "toggle_hide_markers",
    label: "Ocultar marcadores markdown",
    run: () => useLivePreviewStore.getState().toggle(),
    isActive: () => useLivePreviewStore.getState().hideMarkers,
  },
  {
    id: "zoom_in",
    label: "Aumentar",
    shortcut: formatShortcut("⌘="),
    run: () => useZoomStore.getState().zoomIn(),
  },
  {
    id: "zoom_out",
    label: "Diminuir",
    shortcut: formatShortcut("⌘-"),
    run: () => useZoomStore.getState().zoomOut(),
  },
  {
    id: "zoom_reset",
    label: "Tamanho original",
    shortcut: formatShortcut("⌘0"),
    run: () => useZoomStore.getState().resetZoom(),
  },
  {
    id: "export_html",
    label: "Exportar para HTML…",
    run: () => exportActiveTabAsHtml(),
  },
  {
    id: "export_pdf",
    label: "Exportar para PDF…",
    run: () => exportActiveTabAsPdf(),
  },
  {
    id: "check_updates",
    label: "Procurar atualizações…",
    run: () => useUpdateStore.getState().checkManually(),
  },
  {
    id: "theme_system",
    label: "Sistema",
    run: () => useThemeStore.getState().setPreference(THEME_PREFERENCE.theme_system),
    isActive: () => useThemeStore.getState().preference === "system",
  },
  {
    id: "theme_light",
    label: "Claro",
    run: () => useThemeStore.getState().setPreference(THEME_PREFERENCE.theme_light),
    isActive: () => useThemeStore.getState().preference === "light",
  },
  {
    id: "theme_dark",
    label: "Escuro",
    run: () => useThemeStore.getState().setPreference(THEME_PREFERENCE.theme_dark),
    isActive: () => useThemeStore.getState().preference === "dark",
  },
];

const commandsById = new Map(commands.map((command) => [command.id, command]));

/** Roteador central — consumido pelo listener do evento nativo `"menu"` e
 * pela Toolbar. Id desconhecido é no-op silencioso (mesma tolerância que o
 * `switch` anterior tinha para ids fora do `case`). */
export function runCommand(id: string): void {
  void commandsById.get(id)?.run();
}

export function getCommand(id: string): AppCommand | undefined {
  return commandsById.get(id);
}
