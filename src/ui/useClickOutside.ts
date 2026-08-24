import { useEffect, type RefObject } from "react";

/** Fecha um popover ao clicar fora dele ou pressionar Escape — mesma
 * mecânica que existia duplicada em `ThemeToggle.tsx`, `HistoryPanel.tsx` e
 * `ExplorerContextMenu.tsx` (esta última já incluía o `Escape`, as outras
 * duas não; consolidado aqui como o superset das três). `enabled` evita
 * registrar os listeners globais enquanto o popover está fechado. */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;

    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ref, onClose, enabled]);
}
