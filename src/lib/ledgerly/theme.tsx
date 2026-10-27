"use client";

/**
 * ThemeProvider — Light / Dark / System with instant, reload-free switching.
 *
 *  • Dark is the product default.
 *  • The choice is persisted in localStorage under `ledgerly.theme`.
 *  • `system` resolves through matchMedia and keeps following OS changes live.
 *  • The initial class is applied by the inline script in app/layout.tsx before
 *    first paint, so there is no flash of the wrong theme.
 *  • `palette` gives charts and SVG visuals token-accurate colours for the
 *    resolved theme.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Moon, Monitor, Sun } from "lucide-react";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme-script";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ChartPalette {
  brand: string;
  info: string;
  warn: string;
  crit: string;
  violet: string;
  cyan: string;
  slate: string;
  grid: string;
  axis: string;
  surface: string;
  line: string;
  ink: string;
  inkMuted: string;
  series: string[];
}

const DARK_PALETTE: ChartPalette = {
  brand: "#4BE3A4",
  info: "#7CAEFF",
  warn: "#F4BD69",
  crit: "#FF727F",
  violet: "#A78BFA",
  cyan: "#67E8F9",
  slate: "#94A3B8",
  grid: "rgba(146,158,172,0.14)",
  axis: "#647181",
  surface: "#121923",
  line: "#26313D",
  ink: "#F0F4F8",
  inkMuted: "#929EAC",
  series: ["#4BE3A4", "#7CAEFF", "#F4BD69", "#FF727F", "#A78BFA", "#67E8F9", "#94A3B8"],
};

const LIGHT_PALETTE: ChartPalette = {
  brand: "#12795C",
  info: "#2C5FD0",
  warn: "#A86400",
  crit: "#C42B3A",
  violet: "#6D5DD3",
  cyan: "#0E7490",
  slate: "#64748B",
  grid: "rgba(38,49,61,0.10)",
  axis: "#7A8792",
  surface: "#FFFFFF",
  line: "#DDE3E7",
  ink: "#16202A",
  inkMuted: "#52616B",
  series: ["#12795C", "#2C5FD0", "#A86400", "#C42B3A", "#6D5DD3", "#0E7490", "#64748B"],
};

interface ThemeContextValue {
  theme: ThemeChoice;
  resolved: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
  cycle: () => void;
  palette: ChartPalette;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

function readStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("dark");
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  // Adopt the persisted choice after mount (the DOM class is already correct
  // thanks to the inline bootstrap script).
  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    setResolved(stored === "system" ? (systemPrefersLight() ? "light" : "dark") : stored);
  }, []);

  // Follow the OS while in system mode.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const listener = (event: MediaQueryListEvent) => setResolved(event.matches ? "light" : "dark");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [theme]);

  // Apply the resolved theme to <html> and keep `color-scheme` in sync.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    root.dataset.theme = theme;
    root.style.colorScheme = resolved;
  }, [theme, resolved]);

  const setTheme = useCallback(
    (choice: ThemeChoice) => {
      setThemeState(choice);
      setResolved(choice === "system" ? (systemPrefersLight() ? "light" : "dark") : choice);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, choice);
      } catch {
        /* storage unavailable (private mode) — the session still works */
      }
    },
    [],
  );

  const cycle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark");
  }, [setTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved,
      setTheme,
      cycle,
      palette: resolved === "dark" ? DARK_PALETTE : LIGHT_PALETTE,
    }),
    [theme, resolved, setTheme, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}

/** Colours for charts/SVG that always match the active theme. */
export function useChartPalette(): ChartPalette {
  return useTheme().palette;
}

const CHOICES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Compact segmented control used in the top bar and Settings. */
export function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {CHOICES.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={`focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              active ? "bg-surface text-ink shadow-[var(--shadow-1)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            <Icon size={13} strokeWidth={2} />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export { THEME_INIT_SCRIPT };
