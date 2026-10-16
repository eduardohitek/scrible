import { useEffect } from "react";
import { useZoomStore } from "./zoomStore";
import { hasPrimaryModifier } from "../platform/platform";

/**
 * Variantes com Shift do zoom (⌘⇧+ / ⌘⇧_) — as únicas que não têm accelerator
 * nativo (#66). ⌘= e ⌘- **não** são tratados aqui: são itens do menu nativo
 * (app_menu.rs), e um NSMenuItem com o mesmo accelerator intercepta a tecla
 * antes dela chegar à webview (DECISIONS.md #24) — um listener JS pra eles
 * nunca seria alcançado. Mesmo padrão de `useTabShortcuts.ts` (⇧⌘]/[).
 */
export function useZoomShortcuts() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!hasPrimaryModifier(event) || !event.shiftKey) return;

      const { zoomIn, zoomOut } = useZoomStore.getState();

      if (event.key === "+") {
        event.preventDefault();
        void zoomIn();
        return;
      }
      if (event.key === "_") {
        event.preventDefault();
        void zoomOut();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
