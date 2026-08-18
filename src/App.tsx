import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { EditorPane } from "./editor/EditorPane";
import { PreviewPane } from "./preview/PreviewPane";
import { HistoryPanel } from "./history/HistoryPanel";
import { ConflictBanner } from "./conflict/ConflictBanner";
import { ThemeToggle } from "./theme/ThemeToggle";
import { useDocumentStore } from "./store/documentStore";
import { useThemeStore } from "./theme/themeStore";
import "./theme/tokens.css";
import "./App.css";

interface ExternalChangePayload {
  mtime: number;
  content: string;
}

interface WorkspaceError {
  kind: "PermissionDenied" | "Io";
  message: string;
}

function App() {
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(null);
  const content = useDocumentStore((state) => state.content);
  const setContent = useDocumentStore((state) => state.setContent);
  const status = useDocumentStore((state) => state.status);
  const init = useDocumentStore((state) => state.init);
  const flush = useDocumentStore((state) => state.flush);
  const initTheme = useThemeStore((state) => state.init);
  const resolvedTheme = useThemeStore((state) => state.resolved);

  useEffect(() => {
    invoke("workspace_status")
      .then(() => init())
      .catch((err: WorkspaceError) => {
        setWorkspaceError(err);
      });
  }, [init]);

  useEffect(() => {
    void initTheme();
  }, [initTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) void flush();
    });
    const unlistenClose = listen("app-close-requested", () => {
      void (async () => {
        await flush();
        await invoke("quit_app");
      })();
    });
    const unlistenExternalChange = listen<ExternalChangePayload>("external-file-changed", (event) => {
      useDocumentStore.getState().handleExternalChange(event.payload.content, event.payload.mtime);
    });

    return () => {
      void unlistenFocus.then((fn) => fn());
      void unlistenClose.then((fn) => fn());
      void unlistenExternalChange.then((fn) => fn());
    };
  }, [flush]);

  if (workspaceError) {
    return (
      <div className="workspace-error">
        Não foi possível preparar o workspace em ~/Documents/scrible: {workspaceError.message}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <EditorPane value={content} onChange={setContent} />
      <PreviewPane source={content} />
      <ThemeToggle />
      <HistoryPanel />
      {status === "conflict" && <ConflictBanner />}
      {status === "saving" && <div className="save-indicator">Salvando…</div>}
    </div>
  );
}

export default App;
