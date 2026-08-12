import React from 'react';
import { View } from 'react-native';
import { Redirect, Tabs, usePathname, useRouter } from 'expo-router';
import { TabBar, type TabKey } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSession } from '../../src/api/session';
import { useHome } from '../../src/api/HomeProvider';
import { RealtimeProvider } from '../../src/api/RealtimeProvider';
import { useAlerts } from '../../src/api/hooks';

/**
 * Barre de navigation à 5 onglets (doc §6).
 *
 * `TabBar` du design system est un composant contrôlé : on le branche ici sur
 * expo-router plutôt que d'utiliser la barre par défaut, pour garder exactement
 * le rendu de la charte.
 */
const ROUTES: Record<TabKey, string> = {
  accueil: '/(tabs)',
  appareils: '/(tabs)/devices',
  scenarios: '/(tabs)/scenarios',
  alertes: '/(tabs)/alerts',
  profil: '/(tabs)/profile',
};

export default function TabsLayout() {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();
  const { home, homes, isLoading: homesLoading } = useHome();
  const { data: alerts } = useAlerts(home?.id);

  if (status === 'signed-out') return <Redirect href="/login" />;
  // Foyer supprimé ou compte tout neuf : l'application n'a rien à montrer.
  if (!homesLoading && homes.length === 0) return <Redirect href="/onboarding" />;

  const active: TabKey = pathname.includes('/devices')
    ? 'appareils'
    : pathname.includes('/scenarios')
      ? 'scenarios'
      : pathname.includes('/alerts')
        ? 'alertes'
        : pathname.includes('/profile')
          ? 'profil'
          : 'accueil';

  return (
    <RealtimeProvider homeId={home?.id}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Tabs
          tabBar={() => null}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.bg } }}
        />
        <TabBar
          active={active}
          onChange={(key) => router.navigate(ROUTES[key] as never)}
          badges={{ alertes: alerts?.unread_count ?? 0 }}
        />
      </View>
    </RealtimeProvider>
  );
}
