import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Home } from '@domotique/contract';
import { useHomes } from './hooks';

/**
 * Foyer courant.
 *
 * Le modèle est multi-foyer dès l'origine (CDC §4) : le sélecteur du tableau de
 * bord en dépend. Tant qu'un seul foyer existe, il est choisi d'office.
 */
type HomeContextValue = {
  home: Home | undefined;
  homes: Home[];
  select: (homeId: string) => void;
  isLoading: boolean;
};

const HomeContext = createContext<HomeContextValue>({
  home: undefined,
  homes: [],
  select: () => {},
  isLoading: true,
});

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const { data: homes, isLoading } = useHomes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && homes?.length) setSelectedId(homes[0]!.id);
  }, [homes, selectedId]);

  const value = useMemo<HomeContextValue>(
    () => ({
      homes: homes ?? [],
      home: homes?.find((h) => h.id === selectedId) ?? homes?.[0],
      select: setSelectedId,
      isLoading,
    }),
    [homes, selectedId, isLoading],
  );

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>;
}

export function useHome() {
  return useContext(HomeContext);
}
