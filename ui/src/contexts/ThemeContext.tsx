import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'violet' | 'emerald' | 'ocean' | 'crimson' | 'contrast';

export const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'violet',   label: 'Violet',        color: '#b27cf2' },
  { id: 'emerald',  label: 'Emerald',        color: '#4ade80' },
  { id: 'ocean',    label: 'Ocean',          color: '#60a5fa' },
  { id: 'crimson',  label: 'Crimson',        color: '#ff5d73' },
  { id: 'contrast', label: 'High Contrast',  color: '#ffffff' },
];

const STORAGE_KEY = 'palbox-theme';

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'violet', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'violet';
  });

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  }

  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'violet') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', theme);
    }
  }, [theme]);

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
