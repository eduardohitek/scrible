import { useEffect } from "react";
import { useTabsStore } from "../store/tabsStore";

/**
 * Atalhos globais de abas (Cmd+T/W/1-9/Shift+]/[). Registrados em `window`
 * (não há menu nativo — #24 — nem keymap do CodeMirror usando essas teclas
 * hoje, então não há conflito de foco a resolver).
 */
export function useTabShortcuts() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.metaKey) return;

      const { newTab, closeTab, activeTabId, focusTabByIndex, focusNextTab, focusPrevTab } = useTabsStore.getState();

      if (event.key === "t") {
        event.preventDefault();
        void newTab();
        return;
      }
      if (event.key === "w") {
        event.preventDefault();
        if (activeTabId) void closeTab(activeTabId);
        return;
      }
      if (event.shiftKey && event.key === "]") {
        event.preventDefault();
        focusNextTab();
        return;
      }
      if (event.shiftKey && event.key === "[") {
        event.preventDefault();
        focusPrevTab();
        return;
      }
      if (!event.shiftKey) {
        const index = Number(event.key);
        if (Number.isInteger(index) && index >= 1 && index <= 9) {
          event.preventDefault();
          focusTabByIndex(index);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
