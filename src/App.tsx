import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorPane } from "./editor/EditorPane";
import { PreviewPane } from "./preview/PreviewPane";
import "./App.css";

interface WorkspaceError {
  kind: "PermissionDenied" | "Io";
  message: string;
}

const SAMPLE_DOCUMENT = `# scrible

Um editor de **markdown** com preview em tempo real, para macOS.

## Recursos

- [x] Edição com CodeMirror 6
- [x] Preview com markdown-it
- [ ] Autocomplete de sintaxe

\`\`\`mermaid
flowchart TD
    A[Editor] --> B[Preview]
    B --> C{Mermaid ok?}
    C -->|Sim| D[🎉]
\`\`\`
`;

function App() {
  const [source, setSource] = useState(SAMPLE_DOCUMENT);
  const [workspaceError, setWorkspaceError] = useState<WorkspaceError | null>(null);

  useEffect(() => {
    invoke("workspace_status").catch((err: WorkspaceError) => {
      setWorkspaceError(err);
    });
  }, []);

  if (workspaceError) {
    return (
      <div className="workspace-error">
        Não foi possível preparar o workspace em ~/Documents/scrible: {workspaceError.message}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <EditorPane value={source} onChange={setSource} />
      <PreviewPane source={source} />
    </div>
  );
}

export default App;
