import { useEffect } from "react";
import { useLayoutStore } from "./layoutStore";

/**
 * Atalho global de layout (Cmd+Shift+P): alterna a visibilidade do preview.
 * Registrado em `window`, mesmo padrão de useTabShortcuts.ts — sem conflito
 * hoje com CodeMirror nem com os atalhos de abas.
 */
export function useLayoutShortcuts() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void useLayoutStore.getState().togglePreview();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
