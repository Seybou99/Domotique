import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Radio, Cloud } from 'lucide-react-native';
import type { DeviceKind, RoomIcon } from '@domotique/contract';
import {
  Button,
  Card,
  DeviceAvatar,
  ScreenHeader,
  StatusChip,
  Txt,
} from '../src/components';
import { Screen, messageFor } from '../src/screens/shared';
import { deviceIcons, renderIcon, roomIcons } from '../src/lib/icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { font, fontSize, iconStroke, radius, space } from '../src/theme/tokens';
import { useHome } from '../src/api/HomeProvider';
import {
  useDeviceMutations,
  useDiscoveredDevices,
  useHomeState,
  useIntegrations,
  usePairing,
  useUnits,
  type ThirdPartyProviderName,
} from '../src/api/hooks';
import { useRealtime } from '../src/api/RealtimeProvider';

/**
 * Écrans 2.4 à 2.8 — Ajout d'un appareil.
 *
 * Deux chemins, présentés comme des cartes égales (écran 2.4) :
 *  - **Zigbee** : ouvrir la fenêtre d'association du boîtier, attendre que
 *    l'appareil se manifeste, le nommer.
 *  - **Compte tiers** : relier un compte par OAuth, puis choisir quels appareils
 *    importer.
 *
 * Ce ne sont pas deux façons d'ajouter le même appareil : un appareil Zigbee n'a
 * pas de Wi-Fi, un appareil cloud n'a pas de radio Zigbee. Le matériel décide.
 */
type Step = 'source' | 'zigbee' | 'naming' | 'cloud';

export default function DeviceAdd() {
  const t = useTheme();
  const router = useRouter();
  const { home } = useHome();
  const state = useHomeState(home?.id);
  const units = useUnits(home?.id);
  const pairing = usePairing();
  const deviceMutations = useDeviceMutations(home?.id);
  const integrations = useIntegrations(home?.id);
  const { discovered, clearDiscovered, pairingClosed } = useRealtime();

  const [step, setStep] = useState<Step>('source');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [selectedExternal, setSelectedExternal] = useState<Set<string>>(new Set());

  const unit = units.data?.find((u) => u.online) ?? units.data?.[0];
  const rooms = state.data?.rooms ?? [];

  // Décompte de la fenêtre d'association (écran 2.5).
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Dès qu'un appareil se manifeste, on passe au nommage.
  useEffect(() => {
    if (step === 'zigbee' && discovered.length > 0) setStep('naming');
  }, [step, discovered.length]);

  async function startPairing() {
    if (!unit) return;
    setError(null);
    clearDiscovered();
    try {
      const { session } = await pairing.start.mutateAsync({ unitId: unit.id, durationS: 60 });
      const remaining = Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 1000));
      setCountdown(remaining);
      setStep('zigbee');
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  /**
   * Tuya se relie depuis la console du fournisseur, pas depuis l'application :
   * son projet n'expose aucune page d'autorisation. On enregistre simplement le
   * rattachement, puis on liste les appareils du compte associé.
   */
  async function linkConsole(provider: ThirdPartyProviderName) {
    setError(null);
    try {
      const { account } = await integrations.linkConsole.mutateAsync(provider);
      setAccountId(account.id);
      setStep('cloud');
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function linkAccount(provider: ThirdPartyProviderName) {
    if (provider === 'tuya') return linkConsole(provider);
    setError(null);
    try {
      const { url, state: oauthState, redirect_uri } = await integrations.oauthUrl.mutateAsync(provider);

      // Session d'authentification du système plutôt qu'une WebView embarquée :
      // l'utilisateur voit la vraie barre d'URL du fournisseur, et l'app n'a
      // jamais accès à ce qu'il y saisit.
      const result = await WebBrowser.openAuthSessionAsync(url, redirect_uri);
      if (result.type !== 'success') return;

      const returned = new URL(result.url);
      const code = returned.searchParams.get('code');
      const returnedState = returned.searchParams.get('state');
      if (!code || !returnedState) throw new Error('Réponse d’autorisation incomplète');

      const { account } = await integrations.complete.mutateAsync({
        provider,
        code,
        state: returnedState,
      });
      setAccountId(account.id);
      setStep('cloud');
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <Screen isLoading={state.isLoading || units.isLoading}>
      <ScreenHeader
        title="Ajouter un appareil"
        onBack={() => {
          if (step === 'source') router.back();
          else {
            if (unit && step !== 'cloud') void pairing.stop.mutateAsync(unit.id).catch(() => {});
            setStep('source');
          }
        }}
      />

      {error && (
        <Card tint="danger">
          <Txt variant="caption">{error}</Txt>
        </Card>
      )}

      {step === 'source' && (
        <View style={{ gap: space.sm }}>
          <SourceCard
            icon={<Radio size={24} color={t.energy} strokeWidth={iconStroke} />}
            title="Appareil Zigbee"
            description={
              unit
                ? `Via ${unit.name}${unit.online ? '' : ' — hors ligne'}`
                : 'Aucun boîtier associé à ce foyer'
            }
            disabled={!unit?.online}
            onPress={startPairing}
          />
          <SourceCard
            icon={<Cloud size={24} color={t.network} strokeWidth={iconStroke} />}
            title="Compte connecté"
            description="Tuya, Philips Hue, Tapo — importer des appareils déjà installés"
            onPress={() => setStep('cloud')}
          />

          {!unit && (
            <Txt variant="caption" tone="muted">
              Les appareils Zigbee ont besoin d’un boîtier pour communiquer. Les appareils Wi-Fi
              n’en ont pas besoin : ils passent par le compte de leur fabricant.
            </Txt>
          )}
        </View>
      )}

      {step === 'zigbee' && (
        <View style={{ gap: space.md }}>
          <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
            <DeviceAvatar icon={deviceIcons.hub} size={72} active={countdown > 0} tone="network" />
            <Txt variant="card">Recherche en cours</Txt>
            <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              Mettez l’appareil en mode association — souvent en maintenant son bouton quelques
              secondes, jusqu’à ce qu’il clignote.
            </Txt>
            <Txt variant="section" tone={countdown > 10 ? 'network' : 'danger'} tight>
              {countdown} s
            </Txt>
          </Card>

          {(countdown === 0 || pairingClosed) && (
            <Card tint="danger" style={{ gap: space.md }}>
              <Txt variant="body">
                La fenêtre s’est refermée sans qu’aucun appareil ne se manifeste.
              </Txt>
              <Button label="Relancer la recherche" variant="secondary" onPress={startPairing} />
            </Card>
          )}
        </View>
      )}

      {step === 'naming' && (
        <NamingStep
          discovered={discovered[0]!}
          rooms={rooms}
          onCancel={() => setStep('source')}
          onDone={() => router.back()}
        />
      )}

      {step === 'cloud' && (
        <CloudStep
          accountId={accountId}
          accounts={integrations.accounts.data ?? []}
          onLink={linkAccount}
          onPick={setAccountId}
          selected={selectedExternal}
          onToggle={(externalId) =>
            setSelectedExternal((previous) => {
              const next = new Set(previous);
              if (next.has(externalId)) next.delete(externalId);
              else next.add(externalId);
              return next;
            })
          }
          importing={integrations.importDevices.isPending}
          onImport={async () => {
            if (!accountId) return;
            setError(null);
            try {
              await integrations.importDevices.mutateAsync({
                accountId,
                externalIds: [...selectedExternal],
              });
              router.back();
            } catch (caught) {
              setError(messageFor(caught));
            }
          }}
        />
      )}
    </Screen>
  );

  function NamingStep({
    discovered: found,
    rooms: roomList,
    onCancel,
    onDone,
  }: {
    discovered: { externalId: string; suggestedName: string; kind: string };
    rooms: { id: string; name: string; icon: string }[];
    onCancel: () => void;
    onDone: () => void;
  }) {
    const [name, setName] = useState(found.suggestedName);
    const [roomId, setRoomId] = useState<string | null>(roomList[0]?.id ?? null);

    // L'appareil a été créé côté serveur par le connecteur ; on le retrouve par
    // son identifiant externe pour le nommer et le ranger.
    const created = useMemo(
      () => (state.data?.devices ?? []).find((d) => d.source.external_id === found.externalId),
      [found.externalId],
    );

    return (
      <View style={{ gap: space.md }}>
        <Card style={{ gap: space.md, alignItems: 'center' }}>
          <DeviceAvatar
            icon={deviceIcons[(found.kind as DeviceKind) in deviceIcons ? (found.kind as 'plug') : 'plug']}
            size={64}
            active
          />
          <Txt variant="card">Appareil détecté</Txt>
          <StatusChip label={found.externalId} tone="online" dot={false} />
        </Card>

        <Card style={{ gap: space.md }}>
          <Txt variant="micro" tone="secondary">
            Nom
          </Txt>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Nom de l’appareil"
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

          <Txt variant="micro" tone="secondary">
            Pièce
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {roomList.map((room) => {
              const active = roomId === room.id;
              return (
                <Pressable
                  key={room.id}
                  onPress={() => setRoomId(room.id)}
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
                  {renderIcon(
                    roomIcons[(room.icon as RoomIcon) ?? 'autre'] ?? roomIcons.autre,
                    16,
                    active ? t.energy : t.textSecondary,
                  )}
                  <Txt variant="micro" tone={active ? 'energy' : 'secondary'}>
                    {room.name}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <View style={{ gap: space.sm }}>
          <Button
            label="Ajouter l’appareil"
            full
            disabled={!created || name.trim().length === 0}
            loading={deviceMutations.update.isPending}
            onPress={async () => {
              if (!created) return;
              try {
                await deviceMutations.update.mutateAsync({
                  id: created.id,
                  name: name.trim(),
                  room_id: roomId,
                });
                if (unit) await pairing.stop.mutateAsync(unit.id).catch(() => {});
                onDone();
              } catch (caught) {
                setError(messageFor(caught));
              }
            }}
          />
          {!created && (
            <Txt variant="caption" tone="secondary">
              L’appareil se déclare encore auprès du boîtier — patientez quelques secondes.
            </Txt>
          )}
          <Button label="Annuler" variant="ghost" onPress={onCancel} full />
        </View>
      </View>
    );
  }

  function CloudStep(props: {
    accountId: string | null;
    accounts: { id: string; provider: string; account_label: string; device_count: number }[];
    onLink: (provider: ThirdPartyProviderName) => void;
    onPick: (id: string) => void;
    selected: Set<string>;
    onToggle: (externalId: string) => void;
    importing: boolean;
    onImport: () => void;
  }) {
    const discoveredDevices = useDiscoveredDevices(props.accountId ?? undefined);

    if (!props.accountId) {
      return (
        <View style={{ gap: space.md }}>
          {props.accounts.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Txt variant="card">Comptes déjà reliés</Txt>
              {props.accounts.map((account) => (
                <Card
                  key={account.id}
                  onPress={() => props.onPick(account.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
                >
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{account.account_label}</Txt>
                    <Txt variant="dataMicro" tone="secondary">
                      {account.provider} · {account.device_count} appareil
                      {account.device_count > 1 ? 's' : ''}
                    </Txt>
                  </View>
                  <Txt variant="micro" tone="energy">
                    Importer
                  </Txt>
                </Card>
              ))}
            </View>
          )}

          <View style={{ gap: space.sm }}>
            <Txt variant="card">Relier un compte</Txt>
            {(['tuya', 'hue', 'tapo'] as const).map((provider) => (
              <SourceCard
                key={provider}
                icon={<Cloud size={22} color={t.network} strokeWidth={iconStroke} />}
                title={providerLabel(provider)}
                description={
                  provider === 'tuya'
                    ? 'Appairez d’abord vos appareils dans l’app Smart Life, puis touchez ici'
                    : 'Se connecter et importer les appareils du compte'
                }
                onPress={() => props.onLink(provider)}
              />
            ))}

            <Card style={{ gap: space.sm }}>
              <Txt variant="micro" tone="secondary">
                Appareils Tuya, Smart Life, LSC…
              </Txt>
              <Txt variant="caption" tone="secondary">
                Ces appareils s’appairent dans l’application de leur fabricant, sur votre réseau
                Wi-Fi 2,4 GHz. Une fois appairés, ils apparaissent ici et tout se pilote depuis
                cette application.
              </Txt>
            </Card>
          </View>
        </View>
      );
    }

    const items = discoveredDevices.data ?? [];
    return (
      <View style={{ gap: space.md }}>
        <Txt variant="card">Appareils du compte</Txt>
        {discoveredDevices.isLoading ? (
          <Card>
            <Txt variant="caption" tone="secondary">
              Lecture du compte en cours…
            </Txt>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <Txt variant="caption" tone="secondary">
              Aucun appareil sur ce compte.
            </Txt>
          </Card>
        ) : (
          <Card style={{ gap: space.md }}>
            {items.map((device) => {
              const active = props.selected.has(device.external_id);
              const disabled = device.imported || !device.supported;
              return (
                <Pressable
                  key={device.external_id}
                  disabled={disabled}
                  onPress={() => props.onToggle(device.external_id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active, disabled }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm + 2,
                    minHeight: 44,
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      borderWidth: 1.5,
                      borderColor: active ? t.energy : t.lineStrong,
                      backgroundColor: active ? t.energy : 'transparent',
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Txt variant="body" numberOfLines={1}>
                      {device.name}
                    </Txt>
                    {/* Un appareil non pris en charge reste visible, grisé :
                        le faire disparaître laisserait l'utilisateur le chercher. */}
                    {(device.imported || !device.supported) && (
                      <Txt variant="dataMicro" tone="muted">
                        {device.imported ? 'déjà importé' : 'aucune capacité prise en charge'}
                      </Txt>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}

        <Button
          label={`Importer ${props.selected.size} appareil${props.selected.size > 1 ? 's' : ''}`}
          full
          disabled={props.selected.size === 0}
          loading={props.importing}
          onPress={props.onImport}
        />
      </View>
    );
  }

  function SourceCard({
    icon,
    title,
    description,
    onPress,
    disabled,
  }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    onPress: () => void;
    disabled?: boolean;
  }) {
    return (
      <Card
        onPress={disabled ? undefined : onPress}
        accessibilityLabel={title}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {icon}
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{title}</Txt>
          <Txt variant="caption" tone="secondary">
            {description}
          </Txt>
        </View>
      </Card>
    );
  }
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = { tuya: 'Tuya / Smart Life', hue: 'Philips Hue', tapo: 'TP-Link Tapo' };
  return labels[provider] ?? provider;
}
