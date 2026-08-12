import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Parcours d'accueil (design system §7).
 *
 * Hors barre de navigation : l'utilisateur n'a encore ni foyer ni appareil, les
 * cinq onglets n'auraient rien à montrer.
 *
 * Écart assumé avec le document : les étapes liées au boîtier sont
 * **contournables**. Le §7 déroule les neuf écrans comme un chemin unique, mais
 * un client qui n'a que des prises Wi-Fi n'a pas de boîtier — l'obliger à
 * traverser trois écrans de déballage pour rien serait le meilleur moyen de le
 * perdre dès la première minute.
 */
export default function OnboardingLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
        animation: 'slide_from_right',
        // Le parcours se traverse avec les boutons : un retour par geste
        // laisserait revenir sur une étape déjà validée.
        gestureEnabled: false,
      }}
    />
  );
}
