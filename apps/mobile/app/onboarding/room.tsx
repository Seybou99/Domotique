import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { RoomIcon } from '@domotique/contract';
import { Button, Card, ScreenHeader, Txt } from '../../src/components';
import { messageFor } from '../../src/screens/shared';
import { renderIcon, roomIcons } from '../../src/lib/icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { font, fontSize, radius, space } from '../../src/theme/tokens';
import { useHome } from '../../src/api/HomeProvider';
import { useRoomMutations } from '../../src/api/hooks';

/**
 * Écran 8 — Première pièce.
 *
 * Le §7 la justifie ainsi : « pour amorcer le tableau de bord ». Un tableau de
 * bord vide au premier lancement ne donne aucune prise à l'utilisateur ; une
 * pièce, même sans appareil, lui montre à quoi ressemblera sa maison.
 *
 * Les suggestions évitent la page blanche : trois touches et c'est fait.
 */
const SUGGESTIONS: { name: string; icon: RoomIcon }[] = [
  { name: 'Salon', icon: 'salon' },
  { name: 'Cuisine', icon: 'cuisine' },
  { name: 'Chambre', icon: 'chambre' },
  { name: 'Bureau', icon: 'bureau' },
  { name: 'Entrée', icon: 'entree' },
];

export default function FirstRoom() {
  const t = useTheme();
  const router = useRouter();
  const { home } = useHome();
  const rooms = useRoomMutations(home?.id);

  const [name, setName] = useState('Salon');
  const [icon, setIcon] = useState<RoomIcon>('salon');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await rooms.create.mutateAsync({ name: name.trim(), icon, device_ids: [] });
      router.replace('/onboarding/tour');
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ padding: space.md, gap: space.lg, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <ScreenHeader title="Première pièce" subtitle="Étape 3 sur 3" />

            <Txt variant="body" tone="secondary">
              Vos appareils se rangent par pièce. Commencez par celle où vous en avez le plus.
            </Txt>

            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {SUGGESTIONS.map((suggestion) => {
                  const active = name === suggestion.name && icon === suggestion.icon;
                  return (
                    <Pressable
                      key={suggestion.name}
                      onPress={() => {
                        setName(suggestion.name);
                        setIcon(suggestion.icon);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm - 2,
                        height: 40,
                        paddingHorizontal: space.md - 4,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: active ? t.energyRing : t.lineStrong,
                        backgroundColor: active ? t.energySoft : 'transparent',
                      }}
                    >
                      {renderIcon(roomIcons[suggestion.icon], 16, active ? t.energy : t.textSecondary)}
                      <Txt variant="micro" tone={active ? 'energy' : 'secondary'}>
                        {suggestion.name}
                      </Txt>
                    </Pressable>
                  );
                })}
              </View>

              <Txt variant="micro" tone="secondary">
                Ou un autre nom
              </Txt>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Véranda, Garage…"
                placeholderTextColor={t.textMuted}
                style={{
                  height: 52,
                  borderRadius: radius.control,
                  backgroundColor: t.surfaceSunken,
                  borderWidth: 1,
                  borderColor: t.lineStrong,
                  paddingHorizontal: space.md,
                  color: t.text,
                  fontFamily: font.body.regular,
                  fontSize: fontSize.body,
                }}
              />
            </Card>

            {error && (
              <Txt variant="caption" tone="danger">
                {error}
              </Txt>
            )}

            <View style={{ flex: 1 }} />

            <Button
              label="Créer la pièce"
              onPress={submit}
              loading={rooms.create.isPending}
              disabled={name.trim().length === 0}
              full
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
