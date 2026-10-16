import { useEffect } from "react";
import { useTabsStore } from "../store/tabsStore";
import { hasPrimaryModifier } from "../platform/platform";

/**
 * Atalhos globais de abas (Cmd+1-9/Shift+]/[). Registrados em `window` — não
 * têm equivalente no menu nativo (#24), que só cobre Novo/Fechar aba
 * (Cmd+T/Cmd+W, agora exclusividade do menu: um `NSMenuItem` com o mesmo
 * accelerator intercepta o evento antes dele chegar à webview, então os
 * antigos branches `t`/`w` daqui nunca mais seriam alcançados — removidos).
 */
export function useTabShortcuts() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!hasPrimaryModifier(event)) return;

      const { focusTabByIndex, focusNextTab, focusPrevTab } = useTabsStore.getState();

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
