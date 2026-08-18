import { useEffect, useRef, useState } from "react";
import { useThemeStore, type ThemePreference } from "./themeStore";

const LABELS: Record<ThemePreference, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Escuro",
};
const OPTIONS: ThemePreference[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="theme-toggle-container" ref={containerRef}>
      <button type="button" className="theme-toggle" onClick={() => setOpen((prev) => !prev)}>
        {LABELS[preference]}
      </button>
      {open && (
        <ul className="theme-menu">
          {OPTIONS.map((option) => (
            <li key={option}>
              <button
                type="button"
                aria-current={preference === option}
                onClick={() => {
                  void setPreference(option);
                  setOpen(false);
                }}
              >
                {LABELS[option]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
