import * as React from "react";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = Exclude<Theme, "system">;

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  enableSystem?: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme, enableSystem: boolean): ResolvedTheme {
  return theme === "system" && enableSystem ? getSystemTheme() : theme === "dark" ? "dark" : "light";
}

/** SSR-safe theme foundation used by the shared Product Shell. */
function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "halal-erp-theme",
  enableSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme);
  // Keep the first server and browser render deterministic. The actual system
  // preference is applied after hydration in the effect below.
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(
    defaultTheme === "dark" ? "dark" : "light",
  );
  const [hasLoadedPreference, setHasLoadedPreference] = React.useState(false);

  const applyTheme = React.useCallback((nextTheme: ResolvedTheme) => {
    const root = document.documentElement;
    root.classList.toggle("dark", nextTheme === "dark");
    root.style.colorScheme = nextTheme;
    setResolvedTheme(nextTheme);
  }, []);

  React.useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem(storageKey);
      if (isTheme(storedTheme)) setThemeState(storedTheme);
    } catch {
      // Storage can be unavailable in privacy-restricted browser sessions.
    }
    setHasLoadedPreference(true);
  }, [storageKey]);

  React.useEffect(() => {
    if (!hasLoadedPreference) return;

    const nextTheme = resolveTheme(theme, enableSystem);
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(storageKey, theme);
    } catch {
      // Theme selection remains active for the current session.
    }
  }, [applyTheme, enableSystem, hasLoadedPreference, storageKey, theme]);

  React.useEffect(() => {
    if (!hasLoadedPreference || !enableSystem || theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [applyTheme, enableSystem, hasLoadedPreference, theme]);

  const setTheme = React.useCallback((nextTheme: Theme) => setThemeState(nextTheme), []);
  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme doit être utilisé dans un ThemeProvider.");
  }

  return context;
}

export { ThemeProvider, useTheme };
