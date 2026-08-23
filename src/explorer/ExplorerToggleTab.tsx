import { useExplorerStore } from "./explorerStore";

/** Aba fina sempre visível na borda esquerda do app — os 4 cantos já têm
 * botões flutuantes (tema, histórico, preview, indicador de salvamento), sem
 * espaço livre para mais um. Único jeito de reabrir o explorador sem
 * depender de decorar o atalho Cmd+Shift+E. */
export function ExplorerToggleTab() {
  const visible = useExplorerStore((state) => state.visible);
  const toggle = useExplorerStore((state) => state.toggle);

  return (
    <button
      type="button"
      className="explorer-toggle-tab"
      aria-label={visible ? "Ocultar explorador" : "Mostrar explorador"}
      aria-pressed={visible}
      onClick={toggle}
    >
      ▸
    </button>
  );
}
