import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { EditorPane } from "./editor/EditorPane";
import { PreviewPane } from "./preview/PreviewPane";
import { HistoryPanel } from "./history/HistoryPanel";
import { useDocumentStore } from "./store/documentStore";
import "./App.css";

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

  useEffect(() => {
    invoke("workspace_status")
      .then(() => init())
      .catch((err: WorkspaceError) => {
        setWorkspaceError(err);
      });
  }, [init]);

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

    return () => {
      void unlistenFocus.then((fn) => fn());
      void unlistenClose.then((fn) => fn());
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
      <HistoryPanel />
      {status === "saving" && <div className="save-indicator">Salvando…</div>}
    </div>
  );
}

export default App;
