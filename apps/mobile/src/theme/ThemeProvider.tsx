import React, { createContext, useContext, useMemo, useState } from 'react';
import { darkTheme, lightTheme, type Theme } from './theme';

type Ctx = {
  theme: Theme;
  mode: 'dark' | 'light';
  setMode: (m: 'dark' | 'light') => void;
};

const ThemeContext = createContext<Ctx>({
  theme: darkTheme,
  mode: 'dark',
  setMode: () => {},
});

export function ThemeProvider({
  children,
  initialMode = 'dark',
}: {
  children: React.ReactNode;
  initialMode?: 'dark' | 'light';
}) {
  const [mode, setMode] = useState<'dark' | 'light'>(initialMode);
  const value = useMemo(
    () => ({ mode, setMode, theme: mode === 'dark' ? darkTheme : lightTheme }),
    [mode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext).theme;
}

export function useThemeMode() {
  const { mode, setMode } = useContext(ThemeContext);
  return { mode, setMode };
}
