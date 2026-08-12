import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '../src/api/session';
import { useHome } from '../src/api/HomeProvider';
import { useTheme } from '../src/theme/ThemeProvider';

/**
 * Aiguillage d'entrée.
 *
 * Trois destinations : la connexion, le parcours d'accueil, ou l'application.
 * Le critère du parcours d'accueil est **l'absence de foyer**, pas un drapeau
 * « déjà vu » : un compte sans foyer n'a rien à afficher, et un utilisateur qui
 * supprime son dernier foyer doit repasser par la création plutôt que d'atterrir
 * sur un tableau de bord vide.
 */
export default function Index() {
  const { status } = useSession();
  const { homes, isLoading } = useHome();
  const t = useTheme();

  if (status === 'loading' || (status === 'signed-in' && isLoading)) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.energy} />
      </View>
    );
  }
  if (status !== 'signed-in') return <Redirect href="/login" />;
  return <Redirect href={homes.length === 0 ? '/onboarding' : '/(tabs)'} />;
}
