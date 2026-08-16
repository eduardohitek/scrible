import { useState } from "react";
import { EditorPane } from "./editor/EditorPane";
import { PreviewPane } from "./preview/PreviewPane";
import "./App.css";

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

  return (
    <div className="app-shell">
      <EditorPane value={source} onChange={setSource} />
      <PreviewPane source={source} />
    </div>
  );
}

export default App;
