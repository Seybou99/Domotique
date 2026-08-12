import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BreathingRing, Button, Card, StatusChip, Txt } from '../../src/components';
import { deviceIcons, renderIcon } from '../../src/lib/icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { space } from '../../src/theme/tokens';
import { useHome } from '../../src/api/HomeProvider';
import { useUnits } from '../../src/api/hooks';

/**
 * Écran 7 — Confirmation.
 *
 * Le §7 le décrit ainsi : « Boîtier connecté ! avec le breathing ring qui
 * s'active pour la première fois ». C'est le moment où la signature visuelle du
 * produit prend son sens — l'anneau ne pulse que parce qu'un vrai boîtier
 * répond.
 */
export default function Done() {
  const t = useTheme();
  const router = useRouter();
  const { home } = useHome();
  const units = useUnits(home?.id);

  const unit = units.data?.[0];
  const online = unit?.online ?? false;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, padding: space.md, justifyContent: 'space-between' }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl }}>
            <BreathingRing size={140} active={online} online={online} tone="network">
              {renderIcon(deviceIcons.hub, 48, online ? t.network : t.textSecondary)}
            </BreathingRing>

            <View style={{ gap: space.md, alignItems: 'center' }}>
              <Txt variant="section" tight style={{ textAlign: 'center' }}>
                {online ? 'Boîtier connecté' : 'Boîtier associé'}
              </Txt>
              <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
                {online
                  ? 'Il veille désormais sur votre réseau Zigbee. L’anneau pulse tant qu’il est en ligne.'
                  : 'Il est bien rattaché à votre foyer. L’anneau s’animera dès qu’il se connectera — vérifiez qu’il est alimenté.'}
              </Txt>
            </View>

            {unit && (
              <Card style={{ gap: space.sm, alignSelf: 'stretch' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {unit.name}
                  </Txt>
                  <StatusChip
                    label={online ? 'en ligne' : 'hors ligne'}
                    tone={online ? 'online' : 'offline'}
                  />
                </View>
                <Txt variant="dataMicro" tone="muted">
                  {unit.serial}
                </Txt>
              </Card>
            )}
          </View>

          <Button label="Continuer" onPress={() => router.replace('/onboarding/room')} full />
        </View>
      </SafeAreaView>
    </View>
  );
}
