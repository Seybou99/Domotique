import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, Card, Txt } from '../src/components';
import { useTheme } from '../src/theme/ThemeProvider';
import { font, fontSize, radius, space } from '../src/theme/tokens';
import { ApiException, useSession } from '../src/api/session';

const DEMO = { email: 'demo@domotique.local', password: 'demo-mot-de-passe' } as const;

/** Onboarding écran 2 — connexion et inscription. */
export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const { signIn, signUp } = useSession();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await signUp(email.trim(), password, displayName.trim());
      router.replace('/(tabs)');
    } catch (caught) {
      // Design system §14 : formulation factuelle, action possible, sans excuse.
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
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ padding: space.md, gap: space.lg, flexGrow: 1, justifyContent: 'center' }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ gap: space.sm }}>
              <Txt variant="screen" tight>
                Veille active
              </Txt>
              <Txt variant="body" tone="secondary">
                {mode === 'login'
                  ? 'Connectez-vous pour piloter votre maison.'
                  : 'Créez votre compte pour commencer.'}
              </Txt>
            </View>

            <Card style={{ gap: space.md }}>
              {mode === 'signup' && (
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Votre prénom"
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="words"
                  style={input}
                />
              )}
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Adresse e-mail"
                placeholderTextColor={t.textMuted}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                style={input}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Mot de passe"
                placeholderTextColor={t.textMuted}
                secureTextEntry
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                style={input}
              />

              {error && (
                <Txt variant="caption" tone="danger">
                  {error}
                </Txt>
              )}

              <Button
                label={mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
                onPress={submit}
                loading={busy}
                disabled={!email || password.length < (mode === 'signup' ? 10 : 1)}
                full
              />
              {/* Raccourci de développement : le jeu de démonstration du backend
                  (`npm run seed --workspace api`) crée ce compte. Retiré des
                  builds de production par `__DEV__`. */}
              {__DEV__ && mode === 'login' && (
                <Button
                  label="Compte de démonstration"
                  variant="secondary"
                  full
                  onPress={() => {
                    setEmail(DEMO.email);
                    setPassword(DEMO.password);
                    setBusy(true);
                    setError(null);
                    signIn(DEMO.email, DEMO.password)
                      .then(() => router.replace('/(tabs)'))
                      .catch((caught: unknown) => setError(messageFor(caught)))
                      .finally(() => setBusy(false));
                  }}
                />
              )}
              <Button
                label={mode === 'login' ? 'Créer un compte' : 'J’ai déjà un compte'}
                variant="ghost"
                onPress={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError(null);
                }}
                full
              />
            </Card>

            {mode === 'signup' && (
              <Txt variant="micro" tone="muted" style={{ textAlign: 'center' }}>
                Le mot de passe doit faire au moins 10 caractères.
              </Txt>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function messageFor(error: unknown): string {
  if (!(error instanceof ApiException)) {
    return 'Le serveur est injoignable — vérifiez votre connexion.';
  }
  switch (error.code) {
    case 'unauthorized':
      return 'Adresse e-mail ou mot de passe incorrect.';
    case 'conflict':
      return 'Un compte existe déjà pour cette adresse.';
    case 'validation_failed':
      return 'Vérifiez l’adresse e-mail et le mot de passe (10 caractères minimum).';
    case 'rate_limited':
      return 'Trop de tentatives. Réessayez dans quelques minutes.';
    default:
      return 'La connexion a échoué — réessayez.';
  }
}
