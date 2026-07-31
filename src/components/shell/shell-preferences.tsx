import * as React from "react";

export type ShellSidebarWidth = "compact" | "comfortable";
export type ShellDensity = "compact" | "standard" | "comfortable";

interface ShellPreferencesContextValue {
  sidebarWidth: ShellSidebarWidth;
  density: ShellDensity;
  setSidebarWidth: (value: ShellSidebarWidth) => void;
  setDensity: (value: ShellDensity) => void;
}

interface ShellPreferencesProviderProps {
  children: React.ReactNode;
}

const SIDEBAR_WIDTH_STORAGE_KEY = "halal-erp-shell-sidebar-width";
const DENSITY_STORAGE_KEY = "halal-erp-shell-density";

const ShellPreferencesContext = React.createContext<ShellPreferencesContextValue | undefined>(undefined);

function isSidebarWidth(value: string | null): value is ShellSidebarWidth {
  return value === "compact" || value === "comfortable";
}

function isDensity(value: string | null): value is ShellDensity {
  return value === "compact" || value === "standard" || value === "comfortable";
}

function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A browser may forbid storage (private mode or policy). The current UI
    // session keeps working without persisting a preference.
  }
}

function ShellPreferencesProvider({ children }: ShellPreferencesProviderProps) {
  const [sidebarWidth, setSidebarWidthState] = React.useState<ShellSidebarWidth>("compact");
  const [density, setDensityState] = React.useState<ShellDensity>("standard");

  React.useEffect(() => {
    const storedSidebarWidth = readPreference(SIDEBAR_WIDTH_STORAGE_KEY);
    const storedDensity = readPreference(DENSITY_STORAGE_KEY);

    if (isSidebarWidth(storedSidebarWidth)) setSidebarWidthState(storedSidebarWidth);
    if (isDensity(storedDensity)) setDensityState(storedDensity);
  }, []);

  const setSidebarWidth = React.useCallback((value: ShellSidebarWidth) => {
    setSidebarWidthState(value);
    writePreference(SIDEBAR_WIDTH_STORAGE_KEY, value);
  }, []);

  const setDensity = React.useCallback((value: ShellDensity) => {
    setDensityState(value);
    writePreference(DENSITY_STORAGE_KEY, value);
  }, []);

  const value = React.useMemo(
    () => ({ sidebarWidth, density, setSidebarWidth, setDensity }),
    [density, setDensity, setSidebarWidth, sidebarWidth],
  );

  return <ShellPreferencesContext.Provider value={value}>{children}</ShellPreferencesContext.Provider>;
}

function useShellPreferences(): ShellPreferencesContextValue {
  const context = React.useContext(ShellPreferencesContext);
  if (!context) {
    throw new Error("useShellPreferences doit être utilisé dans ShellPreferencesProvider.");
  }

  return context;
}

export { ShellPreferencesProvider, useShellPreferences };
