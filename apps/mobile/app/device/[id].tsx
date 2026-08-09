import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CapabilityState, ChangeOrigin } from '@domotique/contract';
import {
  Card,
  Divider,
  ScreenHeader,
  StatusChip,
  Txt,
  VerticalLevelSlider,
} from '../../src/components';
import { Screen } from '../../src/screens/shared';
import { space } from '../../src/theme/tokens';
import { useHome } from '../../src/api/HomeProvider';
import { useDeviceHistory, useHomeState, useSendCommand } from '../../src/api/hooks';
import { formatAgo } from '../../src/lib/dates';

/** Écran 2.2 — Détail d'un appareil. */
export default function DeviceDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { home } = useHome();
  const state = useHomeState(home?.id);
  const history = useDeviceHistory(id);
  const { send } = useSendCommand(home?.id);

  const device = state.data?.devices.find((d) => d.id === id);
  const room = state.data?.rooms.find((r) => r.id === device?.room_id);

  const onOff = device?.capabilities.find((c) => c.type === 'on_off');
  const brightness = device?.capabilities.find((c) => c.type === 'brightness');
  const energy = device?.capabilities.find((c) => c.type === 'energy');
  const isOn = onOff?.value?.type === 'on_off' && onOff.value.value;
  const level = brightness?.value?.type === 'brightness' ? brightness.value.value : null;

  return (
    <Screen
      isLoading={state.isLoading}
      error={state.error}
      onRetry={() => void state.refetch()}
      refreshing={state.isFetching && !state.isLoading}
      onRefresh={() => void state.refetch()}
    >
      <ScreenHeader
        title={device?.name ?? 'Appareil'}
        subtitle={[
          device?.online ? (isOn ? 'allumé' : 'éteint') : 'hors ligne',
          room?.name,
          protocolLabel(device?.source.protocol),
        ]
          .filter(Boolean)
          .join(' · ')}
        onBack={() => router.back()}
      />

      {device && (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {brightness?.schema.writable && level !== null && (
              <VerticalLevelSlider
                value={level}
                height={240}
                disabled={!device.online}
                onCommit={(value) => send(device.id, { type: 'brightness', value })}
                accessibilityLabel="Luminosité"
                style={{ width: 110 }}
              />
            )}

            <View style={{ flex: 1, gap: space.sm }}>
              {onOff?.schema.writable && (
                <Card
                  tint={isOn ? 'energy' : 'none'}
                  onPress={() => send(device.id, { type: 'on_off', value: !isOn })}
                  accessibilityLabel={isOn ? 'Éteindre' : 'Allumer'}
                  style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Txt variant="card" tone={isOn ? 'energy' : 'secondary'}>
                    {isOn ? 'Allumé' : 'Éteint'}
                  </Txt>
                </Card>
              )}

              {energy?.value?.type === 'energy' && (
                <Card level="raised" style={{ gap: space.xs }}>
                  <Txt variant="micro" tone="secondary">
                    Consommation
                  </Txt>
                  <Txt variant="section" tone="energy" tight>
                    {decimal(energy.value.value, 3)} kWh
                  </Txt>
                  <Txt variant="dataMicro" tone="muted">
                    aujourd’hui
                  </Txt>
                </Card>
              )}
            </View>
          </View>

          {/* Capteurs et mesures : tout ce qui n'est pas pilotable. */}
          {device.capabilities.filter(isMeasure).length > 0 && (
            <Card style={{ gap: space.sm }}>
              <Txt variant="micro" tone="secondary">
                Mesures
              </Txt>
              {device.capabilities
                .filter(isMeasure)
                .map((capability) => (
                  <Row
                    key={capability.type}
                    label={capabilityLabel(capability.type)}
                    value={formatCapability(capability)}
                  />
                ))}
            </Card>
          )}

          <Card style={{ gap: space.sm }}>
            <Txt variant="micro" tone="secondary">
              Informations
            </Txt>
            <Row label="Pièce" value={room?.name ?? 'aucune'} />
            <Row
              label="Protocole"
              value={
                device.source.device_unit_id
                  ? `${protocolLabel(device.source.protocol)} · via boîtier`
                  : protocolLabel(device.source.protocol)
              }
            />
            <Row label="Identifiant" value={device.source.external_id} />
            <Row
              label="Dernière synchro"
              value={device.last_seen ? formatAgo(device.last_seen) : 'jamais'}
            />
            <Divider />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <StatusChip
                label={device.online ? 'en ligne' : 'hors ligne'}
                tone={device.online ? 'online' : 'offline'}
              />
            </View>
          </Card>

          <View style={{ gap: space.sm }}>
            <Txt variant="card">Historique d’état</Txt>
            {(history.data?.length ?? 0) === 0 ? (
              <Card>
                <Txt variant="caption" tone="secondary">
                  Aucun changement enregistré pour l’instant.
                </Txt>
              </Card>
            ) : (
              <Card style={{ gap: space.sm }}>
                {history.data?.map((entry, index) => (
                  <View
                    key={`${entry.at}-${index}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                  >
                    <Txt variant="dataMicro" tone="muted">
                      {new Date(entry.at).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Txt>
                    <Txt variant="dataMicro" style={{ flex: 1 }} numberOfLines={1}>
                      {describeValue(entry.capability)}
                    </Txt>
                    {/* Origine du changement : c'est ce que la maquette montre
                        sous la forme « allumé · app ». */}
                    <Txt variant="dataMicro" tone="secondary" numberOfLines={1}>
                      {describeOrigin(entry.origin)}
                    </Txt>
                  </View>
                ))}
              </Card>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

/** Mesures affichées dans la carte dédiée : tout sauf l'énergie, qui a la sienne. */
function isMeasure(capability: CapabilityState): boolean {
  return !capability.schema.writable && capability.value !== null && capability.type !== 'energy';
}

/** Séparateur décimal français — l'app est en français, le point n'a pas sa place. */
function decimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
      <Txt variant="data" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Txt>
    </View>
  );
}


function protocolLabel(protocol: string | undefined): string {
  const labels: Record<string, string> = { zigbee: 'Zigbee', tuya: 'Tuya', hue: 'Hue', tapo: 'Tapo' };
  return protocol ? (labels[protocol] ?? protocol) : '—';
}

function capabilityLabel(type: string): string {
  const labels: Record<string, string> = {
    temperature: 'Température',
    humidity: 'Humidité',
    battery: 'Pile',
    power: 'Puissance',
    energy: 'Énergie',
    contact: 'Ouverture',
    motion: 'Mouvement',
    leak: 'Fuite',
  };
  return labels[type] ?? type;
}

function formatCapability(capability: CapabilityState): string {
  const value = capability.value;
  if (!value) return '—';
  switch (value.type) {
    case 'temperature':
      return `${decimal(value.value)} °C`;
    case 'humidity':
    case 'battery':
      return `${value.value} %`;
    case 'power':
      return `${Math.round(value.value)} W`;
    case 'energy':
      return `${decimal(value.value, 3)} kWh`;
    case 'contact':
      return value.value === 'open' ? 'ouvert' : 'fermé';
    case 'motion':
      return value.value ? 'mouvement' : 'calme';
    case 'leak':
      return value.value === 'wet' ? 'fuite détectée' : 'sec';
    default:
      return String(value.value);
  }
}

function describeValue(value: { type: string; value: unknown }): string {
  if (value.type === 'on_off') return value.value ? 'allumé' : 'éteint';
  if (value.type === 'brightness') return `niveau ${value.value} %`;
  return `${capabilityLabel(value.type).toLowerCase()} ${String(value.value)}`;
}

function describeOrigin(origin: ChangeOrigin): string {
  switch (origin.kind) {
    case 'user':
      return origin.display_name;
    case 'automation':
      return `scène ${origin.name}`;
    case 'device':
      return 'appareil';
    case 'external':
      return origin.provider;
    default:
      return '';
  }
}
