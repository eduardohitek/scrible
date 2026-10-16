import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { runCommand } from "../commands/registry";
import { useClickOutside } from "../ui/useClickOutside";

/** Mesmo idioma de popover de `ThemeToggle`/`HistoryPanel` — um único slot
 * na toolbar para as duas ações de exportação, que hoje só existem no menu
 * nativo (#26/#27). Um ícone só, não dois. */
export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  function runAndClose(id: string) {
    runCommand(id);
    setOpen(false);
  }

  return (
    <div className="export-menu-container" ref={containerRef}>
      <button
        type="button"
        className="icon-button"
        aria-label="Exportar"
        aria-pressed={open}
        data-tooltip="Exportar"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Download size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className="popover-surface export-menu">
          <li>
            <button type="button" className="popover-menu-item" onClick={() => runAndClose("export_html")}>
              Exportar para HTML…
            </button>
          </li>
          <li>
            <button type="button" className="popover-menu-item" onClick={() => runAndClose("export_pdf")}>
              Exportar para PDF…
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
