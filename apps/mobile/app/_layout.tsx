import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
// Import par sous-chemin, et pas depuis la racine du paquet : importer
// `@expo-google-fonts/inter` embarque les 18 graisses dans le binaire. Ici on
// n'embarque que les 7 fichiers réellement utilisés par la charte.
import SpaceGrotesk_600SemiBold from '@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf';
import SpaceGrotesk_700Bold from '@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf';
import Inter_400Regular from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf';
import Inter_500Medium from '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf';
import Inter_600SemiBold from '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf';
import JetBrainsMono_400Regular from '@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf';
import JetBrainsMono_500Medium from '@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { SessionProvider } from '../src/api/session';
import { HomeProvider } from '../src/api/HomeProvider';

/**
 * Deux tentatives sur les erreurs réseau, aucune sur les erreurs applicatives :
 * réessayer un 403 ne le transformera pas en 200, et ça retarde l'affichage du
 * message d'erreur.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

function Root() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
          // Doc §5 : glissement horizontal discret, jamais de rebond ni de zoom.
          animation: 'slide_from_right',
        }}
      />
    </>
  );
}

export default function Layout() {
  const [loaded] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#141A22' }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <HomeProvider>
              <ThemeProvider initialMode="dark">
                {/* Fond peint avant le chargement des polices : pas de flash blanc. */}
                {loaded ? <Root /> : <View style={{ flex: 1, backgroundColor: '#141A22' }} />}
              </ThemeProvider>
            </HomeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
