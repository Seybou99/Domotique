import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { homes as homesApi } from '@domotique/contract';
import { Button, Card, ScreenHeader, Txt } from '../../src/components';
import { messageFor } from '../../src/screens/shared';
import { useTheme } from '../../src/theme/ThemeProvider';
import { font, fontSize, radius, space } from '../../src/theme/tokens';
import { useSession } from '../../src/api/session';
import { keys } from '../../src/api/hooks';

/**
 * Écran 3 — Création du foyer.
 *
 * Le fuseau est déduit de l'appareil plutôt que demandé : c'est une donnée
 * technique dont l'utilisateur n'a pas à se soucier, mais sans laquelle
 * « chaque soir à 23:30 » ne veut rien dire côté serveur.
 *
 * L'adresse reste facultative — elle ne sert qu'à la météo locale, et la
 * réclamer d'emblée pour piloter une lampe est intrusif.
 */
export default function CreateHome() {
  const t = useTheme();
  const router = useRouter();
  const { api } = useSession();
  const client = useQueryClient();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.call(homesApi.create, {
        body: {
          name: name.trim(),
          timezone,
          ...(address.trim() ? { address: address.trim() } : {}),
        },
      });
      // Le sélecteur de foyer lit cette requête : sans invalidation, l'étape
      // suivante ne trouverait aucun foyer.
      await client.invalidateQueries({ queryKey: keys.homes });
      router.push('/onboarding/hub');
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
    fontFamily: font.body.regular,
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
            <ScreenHeader
              title="Votre foyer"
              subtitle="Étape 1 sur 3"
              onBack={() => router.back()}
            />

            <Txt variant="body" tone="secondary">
              Donnez un nom à votre maison. Vous pourrez en ajouter d’autres plus tard —
              une résidence secondaire, le logement d’un proche.
            </Txt>

            <Card style={{ gap: space.md }}>
              <Txt variant="micro" tone="secondary">
                Nom du foyer
              </Txt>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Maison des Lilas"
                placeholderTextColor={t.textMuted}
                autoFocus
                style={input}
              />

              <Txt variant="micro" tone="secondary">
                Adresse — facultatif
              </Txt>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="12 rue des Lilas, Paris"
                placeholderTextColor={t.textMuted}
                style={input}
              />
              <Txt variant="dataMicro" tone="muted">
                Sert uniquement à la météo locale. Fuseau détecté : {timezone}
              </Txt>
            </Card>

            {error && (
              <Txt variant="caption" tone="danger">
                {error}
              </Txt>
            )}

            <View style={{ flex: 1 }} />

            <Button
              label="Continuer"
              onPress={submit}
              loading={busy}
              disabled={name.trim().length === 0}
              full
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
