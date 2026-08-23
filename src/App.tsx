import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { HistoryPanel } from "./history/HistoryPanel";
import { ConflictBanner } from "./conflict/ConflictBanner";
import { ThemeToggle } from "./theme/ThemeToggle";
import { TabBar } from "./tabs/TabBar";
import { useTabShortcuts } from "./tabs/useTabShortcuts";
import { SplitLayout, type SplitLayoutHandle } from "./layout/SplitLayout";
import { PreviewToggleButton } from "./layout/PreviewToggleButton";
import { useLayoutStore } from "./layout/layoutStore";
import { useDocumentStore, DEFAULT_DOCUMENT } from "./store/documentStore";
import { useTabsStore } from "./store/tabsStore";
import { useExplorerStore } from "./explorer/explorerStore";
import { ExplorerPanel } from "./explorer/ExplorerPanel";
import { ExplorerToggleTab } from "./explorer/ExplorerToggleTab";
import { useThemeStore, type ThemePreference } from "./theme/themeStore";
import "./theme/tokens.css";
import "./App.css";

const THEME_MENU_PREFERENCE: Record<string, ThemePreference> = {
  theme_system: "system",
  theme_light: "light",
  theme_dark: "dark",
};

interface ExternalChangePayload {
  mtime: number;
  content: string;
}

interface WorkspacePaths {
  root: string;
  hidden: string;
}

interface WorkspaceError {
  kind: "PermissionDenied" | "Io";
  message: string;
}

function App() {
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(null);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const activeDoc = useDocumentStore((state) => (activeTabId ? state.documents[activeTabId] : undefined));
  const flushAll = useDocumentStore((state) => state.flushAll);
  const initTheme = useThemeStore((state) => state.init);
  const resolvedTheme = useThemeStore((state) => state.resolved);
  const initLayout = useLayoutStore((state) => state.init);
  const splitLayoutRef = useRef<SplitLayoutHandle>(null);

  useTabShortcuts();

  useEffect(() => {
    invoke<WorkspacePaths>("workspace_status")
      .then(async ({ root }) => {
        useTabsStore.getState().setWorkspaceRoot(root);
        await useTabsStore.getState().openTab(`${root}/untitled.md`, { fallbackContent: DEFAULT_DOCUMENT });
        await useExplorerStore.getState().init(root);
      })
      .catch((err: WorkspaceError) => {
        setWorkspaceError(err);
      });
  }, []);

  useEffect(() => {
    void initTheme();
  }, [initTheme]);

  useEffect(() => {
    void initLayout();
  }, [initLayout]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) void flushAll();
    });
    const unlistenClose = listen("app-close-requested", () => {
      void (async () => {
        await flushAll();
        await invoke("quit_app");
      })();
    });
    const unlistenExternalChange = listen<ExternalChangePayload>("external-file-changed", (event) => {
      // O watcher (#10) só observa o path fixo original (dívida documentada
      // em DECISIONS.md #21) — roteia o evento só se alguma aba aberta tiver
      // exatamente esse path; se nenhuma bater (renomeada, ou nunca aberta),
      // é ignorado.
      const { workspaceRoot, tabs } = useTabsStore.getState();
      const watchedPath = workspaceRoot ? `${workspaceRoot}/untitled.md` : null;
      const tab = tabs.find((t) => t.path === watchedPath);
      if (!tab) return;
      useDocumentStore.getState().handleExternalChange(tab.id, event.payload.content, event.payload.mtime);
    });
    // Watcher recursivo dedicado ao explorador (#25, tree_watcher.rs) — evento
    // sem payload, o frontend decide o que re-buscar (raiz + pastas expandidas).
    const unlistenTreeChange = listen("workspace-tree-changed", () => {
      void useExplorerStore.getState().refreshVisible();
    });
    // Itens do menu nativo (#24) que não são `Predefined*` chegam aqui como
    // string simples via `app.emit("menu", id)` (Rust). "quit" não passa por
    // este evento — é tratado inteiramente em Rust (`window.close()` reaproveita
    // o handshake de flush já cablado em `app-close-requested`, ver acima).
    const unlistenMenu = listen<string>("menu", (event) => {
      const { activeTabId, newTab, closeTab, openFileDialog, startRenaming } = useTabsStore.getState();
      switch (event.payload) {
        case "new_tab":
          void newTab();
          break;
        case "open_file":
          void openFileDialog();
          break;
        case "close_tab":
          if (activeTabId) void closeTab(activeTabId);
          break;
        case "rename_tab":
          if (activeTabId) startRenaming(activeTabId);
          break;
        case "find":
          splitLayoutRef.current?.openSearch();
          break;
        case "toggle_preview":
          void useLayoutStore.getState().togglePreview();
          break;
        case "toggle_explorer":
          useExplorerStore.getState().toggle();
          break;
        case "theme_system":
        case "theme_light":
        case "theme_dark":
          void useThemeStore.getState().setPreference(THEME_MENU_PREFERENCE[event.payload]);
          break;
      }
    });

    return () => {
      void unlistenFocus.then((fn) => fn());
      void unlistenClose.then((fn) => fn());
      void unlistenExternalChange.then((fn) => fn());
      void unlistenTreeChange.then((fn) => fn());
      void unlistenMenu.then((fn) => fn());
    };
  }, [flushAll]);

  if (workspaceError) {
    return (
      <div className="workspace-error">
        Não foi possível preparar o workspace em ~/Documents/scrible: {workspaceError.message}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ExplorerToggleTab />
      <ExplorerPanel />
      <div className="app-shell-content">
        <TabBar />
        <SplitLayout ref={splitLayoutRef} tabId={activeTabId} source={activeDoc?.content ?? ""} />
        <ThemeToggle />
        <HistoryPanel />
        <PreviewToggleButton />
        {activeDoc?.status === "conflict" && <ConflictBanner />}
        {activeDoc?.status === "saving" && <div className="save-indicator">Salvando…</div>}
      </div>
    </div>
  );
}

export default App;
