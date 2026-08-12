import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { units as unitsApi } from '@domotique/contract';
import { Button, Card, ScreenHeader, Txt } from '../../src/components';
import { messageFor } from '../../src/screens/shared';
import { useTheme } from '../../src/theme/ThemeProvider';
import { font, fontSize, radius, space } from '../../src/theme/tokens';
import { useSession } from '../../src/api/session';
import { useHome } from '../../src/api/HomeProvider';
import { keys } from '../../src/api/hooks';

/**
 * Repli du scan : saisie manuelle.
 *
 * Indispensable au support. Un QR code abîmé, une caméra refusée, un boîtier
 * installé dans un placard sombre — sans cette porte de sortie, l'utilisateur
 * est bloqué et n'a plus qu'à appeler.
 */
export default function Manual() {
  const t = useTheme();
  const router = useRouter();
  const { api } = useSession();
  const { home } = useHome();
  const client = useQueryClient();

  const [serial, setSerial] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!home) return;
    setBusy(true);
    setError(null);
    try {
      await api.call(unitsApi.claim, {
        body: {
          serial: serial.trim().toUpperCase(),
          claim_code: code.trim().toUpperCase(),
          home_id: home.id,
        },
      });
      await client.invalidateQueries({ queryKey: keys.units(home.id) });
      await client.invalidateQueries({ queryKey: keys.homeState(home.id) });
      router.replace('/onboarding/done');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const input = {
    height: 52,
    borderRadius: radius.control,
    backgroundColor: t.surfaceSunken,
    borderWidth: 1,
    borderColor: t.lineStrong,
    paddingHorizontal: space.md,
    color: t.text,
    // Mono : ce sont des identifiants techniques, et le O se distingue du 0.
    fontFamily: font.mono.regular,
    fontSize: fontSize.body,
  } as const;

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
            <ScreenHeader title="Saisir le code" onBack={() => router.back()} />

            <Txt variant="body" tone="secondary">
              Les deux valeurs figurent sous le QR code, au dos du boîtier.
            </Txt>

            <Card style={{ gap: space.md }}>
              <Txt variant="micro" tone="secondary">
                Numéro de série
              </Txt>
              <TextInput
                value={serial}
                onChangeText={setSerial}
                placeholder="DMT-XXXXXXXX"
                placeholderTextColor={t.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                style={input}
              />

              <Txt variant="micro" tone="secondary">
                Code d’appairage
              </Txt>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="XXXXXXXXXX"
                placeholderTextColor={t.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                style={input}
              />
            </Card>

            {error && (
              <Card tint="danger">
                <Txt variant="caption">{error}</Txt>
              </Card>
            )}

            <View style={{ flex: 1 }} />

            <Button
              label="Associer le boîtier"
              onPress={submit}
              loading={busy}
              disabled={serial.trim().length < 6 || code.trim().length < 6}
              full
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
