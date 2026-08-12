import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQueryClient } from '@tanstack/react-query';
import { units as unitsApi } from '@domotique/contract';
import { Button, Card, ScreenHeader, Txt } from '../../src/components';
import { messageFor } from '../../src/screens/shared';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/tokens';
import { useSession } from '../../src/api/session';
import { useHome } from '../../src/api/HomeProvider';
import { keys } from '../../src/api/hooks';

/**
 * Écran 6 — Association du boîtier par QR code (CDC §8.2).
 *
 * Le QR encode le numéro de série et un code d'appairage à usage unique. Ce
 * code n'authentifie pas le boîtier de façon permanente — c'est son certificat
 * qui s'en charge ; il ne sert qu'à prouver que la personne qui réclame l'unité
 * l'a physiquement entre les mains.
 */
export default function Scan() {
  const t = useTheme();
  const router = useRouter();
  const { api } = useSession();
  const { home } = useHome();
  const client = useQueryClient();

  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Empêche les scans en rafale : la caméra émet plusieurs fois le même code. */
  const handled = useRef(false);

  async function onScanned(data: string) {
    if (handled.current || !home) return;
    handled.current = true;
    setBusy(true);
    setError(null);

    const parsed = parsePayload(data);
    if (!parsed) {
      setError('Ce QR code n’est pas celui d’un boîtier.');
      setBusy(false);
      handled.current = false;
      return;
    }

    try {
      await api.call(unitsApi.claim, {
        body: { serial: parsed.serial, claim_code: parsed.claimCode, home_id: home.id },
      });
      await client.invalidateQueries({ queryKey: keys.units(home.id) });
      await client.invalidateQueries({ queryKey: keys.homeState(home.id) });
      router.replace('/onboarding/done');
    } catch (caught) {
      setError(messageFor(caught));
      setBusy(false);
      // On réarme : l'utilisateur peut viser à nouveau sans quitter l'écran.
      handled.current = false;
    }
  }

  if (!permission?.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <View style={{ padding: space.md, gap: space.lg, flex: 1 }}>
            <ScreenHeader title="Scanner le boîtier" onBack={() => router.back()} />
            <Card style={{ gap: space.md }}>
              <Txt variant="body">
                L’application a besoin de la caméra pour lire le QR code collé sur votre boîtier.
              </Txt>
              <Txt variant="caption" tone="secondary">
                Aucune image n’est enregistrée ni transmise : la caméra ne sert qu’à décoder le code.
              </Txt>
              <Button label="Autoriser la caméra" onPress={() => void requestPermission()} full />
            </Card>
            <Button
              label="Saisir le code à la main"
              variant="ghost"
              onPress={() => router.push('/onboarding/manual')}
              full
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void onScanned(data)}
      />

      {/* Viseur : une fenêtre claire au centre, le reste assombri. */}
      <View style={{ ...StyleSheetAbsolute, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: 240,
            height: 240,
            borderRadius: radius.card,
            borderWidth: 2,
            borderColor: t.energy,
          }}
        />
      </View>

      <SafeAreaView style={{ ...StyleSheetAbsolute }} pointerEvents="box-none">
        <View style={{ padding: space.md }}>
          <ScreenHeader title="Scanner le boîtier" onBack={() => router.back()} />
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        <View style={{ padding: space.md, gap: space.sm }}>
          {error ? (
            <Card tint="danger">
              <Txt variant="caption">{error}</Txt>
            </Card>
          ) : (
            <Card>
              <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                {busy ? 'Association en cours…' : 'Placez le QR code du boîtier dans le cadre.'}
              </Txt>
            </Card>
          )}
          <Button
            label="Saisir le code à la main"
            variant="secondary"
            onPress={() => router.push('/onboarding/manual')}
            full
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const StyleSheetAbsolute = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

/**
 * Deux formats acceptés : le JSON produit par le provisionnement usine, et une
 * forme courte `SERIE:CODE` qu'un opérateur peut lire à voix haute au support.
 */
export function parsePayload(data: string): { serial: string; claimCode: string } | null {
  try {
    const json = JSON.parse(data) as { serial?: unknown; claim_code?: unknown };
    if (typeof json.serial === 'string' && typeof json.claim_code === 'string') {
      return { serial: json.serial, claimCode: json.claim_code };
    }
  } catch {
    // Pas du JSON : on tente la forme courte.
  }

  const short = /^([A-Za-z0-9-]{6,64}):([A-Za-z0-9]{6,64})$/.exec(data.trim());
  if (short) return { serial: short[1]!, claimCode: short[2]! };

  return null;
}
