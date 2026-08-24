import { useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore, type ThemePreference } from "./themeStore";
import { useClickOutside } from "../ui/useClickOutside";

const LABELS: Record<ThemePreference, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Escuro",
};
const ICONS: Record<ThemePreference, typeof Monitor> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};
const OPTIONS: ThemePreference[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  useClickOutside(containerRef, () => setOpen(false), open);

  const Icon = ICONS[preference];

  return (
    <div className="theme-toggle-container" ref={containerRef}>
      <button
        type="button"
        className="icon-button"
        aria-label={`Tema — ${LABELS[preference]}`}
        aria-pressed={open}
        data-tooltip={`Tema — ${LABELS[preference]}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className="popover-surface theme-menu">
          {OPTIONS.map((option) => (
            <li key={option}>
              <button
                type="button"
                className="popover-menu-item"
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
