import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { HistoryPanel } from "./history/HistoryPanel";
import { ConflictBanner } from "./conflict/ConflictBanner";
import { ThemeToggle } from "./theme/ThemeToggle";
import { TabBar } from "./tabs/TabBar";
import { useTabShortcuts } from "./tabs/useTabShortcuts";
import { SplitLayout } from "./layout/SplitLayout";
import { PreviewToggleButton } from "./layout/PreviewToggleButton";
import { useLayoutShortcuts } from "./layout/useLayoutShortcuts";
import { useLayoutStore } from "./layout/layoutStore";
import { useDocumentStore, DEFAULT_DOCUMENT } from "./store/documentStore";
import { useTabsStore } from "./store/tabsStore";
import { useThemeStore } from "./theme/themeStore";
import "./theme/tokens.css";
import "./App.css";

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

  useTabShortcuts();
  useLayoutShortcuts();

  useEffect(() => {
    invoke<WorkspacePaths>("workspace_status")
      .then(async ({ root }) => {
        useTabsStore.getState().setWorkspaceRoot(root);
        await useTabsStore.getState().openTab(`${root}/untitled.md`, { fallbackContent: DEFAULT_DOCUMENT });
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

    return () => {
      void unlistenFocus.then((fn) => fn());
      void unlistenClose.then((fn) => fn());
      void unlistenExternalChange.then((fn) => fn());
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
      <TabBar />
      <SplitLayout tabId={activeTabId} source={activeDoc?.content ?? ""} />
      <ThemeToggle />
      <HistoryPanel />
      <PreviewToggleButton />
      {activeDoc?.status === "conflict" && <ConflictBanner />}
      {activeDoc?.status === "saving" && <div className="save-indicator">Salvando…</div>}
    </div>
  );
}

export default App;
