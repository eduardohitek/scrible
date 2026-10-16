import { afterEach, describe, expect, it, vi } from "vitest";
import { formatShortcut, hasPrimaryModifier, isMac } from "./platform";

function setPlatform(value: string) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(value);
}

afterEach(() => vi.restoreAllMocks());

describe("platform", () => {
  it("isMac reconhece MacIntel e rejeita Win32/Linux", () => {
    setPlatform("MacIntel");
    expect(isMac()).toBe(true);
    setPlatform("Win32");
    expect(isMac()).toBe(false);
    setPlatform("Linux x86_64");
    expect(isMac()).toBe(false);
  });

  it("hasPrimaryModifier usa metaKey no macOS e ctrlKey nos outros", () => {
    setPlatform("MacIntel");
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(false);
    setPlatform("Win32");
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("formatShortcut mantém símbolos no macOS e usa Ctrl+ nos outros", () => {
    setPlatform("MacIntel");
    expect(formatShortcut("⇧⌘P")).toBe("⇧⌘P");
    setPlatform("Linux x86_64");
    expect(formatShortcut("⌘T")).toBe("Ctrl+T");
    expect(formatShortcut("⇧⌘P")).toBe("Ctrl+Shift+P");
    expect(formatShortcut("⌘=")).toBe("Ctrl+=");
  });
});
