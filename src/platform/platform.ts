/** `navigator.platform` vem vazio no jsdom — os testes que dependem de
 * plataforma precisam forçar o valor (ver `platform.test.ts`). */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /^Mac/i.test(navigator.platform);
}

export function isWindows(): boolean {
  return typeof navigator !== "undefined" && /^Win/i.test(navigator.platform);
}

/** Tecla "primária" da plataforma: ⌘ no macOS, Ctrl nos demais (DECISIONS.md #32). */
export function hasPrimaryModifier(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}

/** Converte um atalho escrito no formato do macOS ("⇧⌘P", "⌘=") para o rótulo
 * da plataforma atual ("Ctrl+Shift+P"). */
export function formatShortcut(macShortcut: string): string {
  if (isMac()) return macShortcut;
  const parts: string[] = [];
  let rest = macShortcut;
  if (rest.includes("⇧")) {
    parts.push("Shift");
    rest = rest.replace("⇧", "");
  }
  if (rest.includes("⌘")) {
    parts.unshift("Ctrl");
    rest = rest.replace("⌘", "");
  }
  return [...parts, rest].join("+");
}
