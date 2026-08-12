import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, BreathingRing, Txt } from '../../src/components';
import { renderIcon, roomIcons } from '../../src/lib/icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { space } from '../../src/theme/tokens';
import { useSession } from '../../src/api/session';

/** Écran 1 — Bienvenue. */
export default function Welcome() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useSession();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: space.md, justifyContent: 'space-between' }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl }}>
            {/* L'anneau de respiration dès le premier écran : c'est la signature
                du produit, autant l'introduire avant d'expliquer quoi que ce soit. */}
            <BreathingRing size={140} active online tone="energy">
              {renderIcon(roomIcons.autre, 52, t.energy)}
            </BreathingRing>

            <View style={{ gap: space.md, alignItems: 'center' }}>
              <Txt variant="screen" tight style={{ textAlign: 'center' }}>
                {user ? `Bienvenue, ${user.display_name}` : 'Veille active'}
              </Txt>
              <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
                Votre maison n’est jamais vraiment éteinte : elle veille, prête à réagir.
                Configurons-la en quelques étapes.
              </Txt>
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Button label="Commencer" onPress={() => router.push('/onboarding/home')} full />
            <Txt variant="micro" tone="muted" style={{ textAlign: 'center' }}>
              Trois minutes, et vous pourrez piloter votre première pièce.
            </Txt>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
