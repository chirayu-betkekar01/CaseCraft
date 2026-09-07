import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "casecraft-theme";

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);

    try {
      if (theme === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private browsing or blocked storage: the choice just will not persist.
    }
  }, [theme]);

  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon"
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
    >
      {resolved === "dark" ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line
              key={angle}
              x1={8 + 5 * Math.cos((angle * Math.PI) / 180)}
              y1={8 + 5 * Math.sin((angle * Math.PI) / 180)}
              x2={8 + 6.6 * Math.cos((angle * Math.PI) / 180)}
              y2={8 + 6.6 * Math.sin((angle * Math.PI) / 180)}
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          ))}
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path
            d="M13.4 9.9A5.9 5.9 0 0 1 6.1 2.6a5.9 5.9 0 1 0 7.3 7.3Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
