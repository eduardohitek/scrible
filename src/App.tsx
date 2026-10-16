import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ConflictBanner } from "./conflict/ConflictBanner";
import { TabBar } from "./tabs/TabBar";
import { useTabShortcuts } from "./tabs/useTabShortcuts";
import { SplitLayout, type SplitLayoutHandle } from "./layout/SplitLayout";
import { useLayoutStore } from "./layout/layoutStore";
import { useDocumentStore, DEFAULT_DOCUMENT } from "./store/documentStore";
import { useTabsStore } from "./store/tabsStore";
import { initFileIndex, refreshFileIndex } from "./workspace/fileIndex";
import { normalizePath } from "./fs/paths";
import { useExplorerStore } from "./explorer/explorerStore";
import { ExplorerPanel } from "./explorer/ExplorerPanel";
import { useThemeStore } from "./theme/themeStore";
import { useZoomStore } from "./zoom/zoomStore";
import { useZoomShortcuts } from "./zoom/useZoomShortcuts";
import { runCommand, setEditorBridge } from "./commands/registry";
import { Toolbar } from "./ui/Toolbar";
import { StatusBar } from "./ui/StatusBar";
import { UpdateBanner } from "./updater/UpdateBanner";
import { useUpdateStore } from "./updater/updateStore";
import { restoreSession, startSessionPersistence, type SessionPersistence } from "./session/session";
import "./theme/tokens.css";
import "./App.css";
import "./preview/PreviewPane.css";

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
  const initZoom = useZoomStore((state) => state.init);
  const splitLayoutRef = useRef<SplitLayoutHandle>(null);
  const sessionRef = useRef<SessionPersistence | null>(null);
  const bootstrappedRef = useRef(false);

  useTabShortcuts();
  useZoomShortcuts();

  useEffect(() => {
    // Ref (não módulo) porque o StrictMode em dev roda este efeito duas vezes
    // na mesma instância — restaurar a sessão duas vezes duplicaria as abas.
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    invoke<WorkspacePaths>("workspace_status")
      .then(async ({ root: rawRoot }) => {
        const root = normalizePath(rawRoot);
        useTabsStore.getState().setWorkspaceRoot(root);
        void initFileIndex(root);
        // Sessão anterior (#9); sem ela (primeira execução) abre o documento padrão.
        const restored = await restoreSession();
        if (!restored) {
          await useTabsStore.getState().openTab(`${root}/untitled.md`, { fallbackContent: DEFAULT_DOCUMENT });
        }
        sessionRef.current = startSessionPersistence();
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
    void initZoom();
  }, [initZoom]);

  useEffect(() => {
    void useUpdateStore.getState().checkOnStartup();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    setEditorBridge({ openSearch: () => splitLayoutRef.current?.openSearch() });
    return () => setEditorBridge(null);
  }, []);

  useEffect(() => {
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        void flushAll();
        void sessionRef.current?.flush();
      }
    });
    const unlistenClose = listen("app-close-requested", () => {
      void (async () => {
        await flushAll();
        await sessionRef.current?.flush();
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
      void refreshFileIndex();
    });
    // Itens do menu nativo (#24) que não são `Predefined*` chegam aqui como
    // string simples via `app.emit("menu", id)` (Rust). "quit" não passa por
    // este evento — é tratado inteiramente em Rust (`window.close()` reaproveita
    // o handshake de flush já cablado em `app-close-requested`, ver acima).
    const unlistenMenu = listen<string>("menu", (event) => {
      runCommand(event.payload);
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
      <ExplorerPanel />
      <div className="app-shell-content">
        <header className="app-header">
          <TabBar />
          <Toolbar />
        </header>
        <UpdateBanner />
        {activeDoc?.status === "conflict" && <ConflictBanner />}
        <SplitLayout ref={splitLayoutRef} tabId={activeTabId} source={activeDoc?.content ?? ""} />
        <StatusBar />
      </div>
    </div>
  );
}

export default App;
