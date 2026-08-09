import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pencil, Power } from 'lucide-react-native';
import type { Device } from '@domotique/contract';
import {
  Card,
  DeviceRow,
  EmptyState,
  IconButton,
  LevelSlider,
  ScreenHeader,
  Txt,
} from '../../src/components';
import { Screen } from '../../src/screens/shared';
import { toDeviceRow } from '../../src/api/adapters';
import { deviceIcons, roomIcons, type RoomKind } from '../../src/lib/icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { iconStroke, space } from '../../src/theme/tokens';
import { useHome } from '../../src/api/HomeProvider';
import { useHomeState, useSendCommand } from '../../src/api/hooks';

/** Écran 1.2 — Détail d'une pièce, contrôle direct sans changer d'écran. */
export default function Room() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { home } = useHome();
  const state = useHomeState(home?.id);
  const { send } = useSendCommand(home?.id);

  const room = state.data?.rooms.find((r) => r.id === id);
  const devices = useMemo(
    () => (state.data?.devices ?? []).filter((d) => d.room_id === id),
    [state.data, id],
  );

  const switchable = devices.filter((d) => writable(d, 'on_off'));
  const activeCount = devices.filter(isOn).length;

  return (
    <Screen
      isLoading={state.isLoading}
      error={state.error}
      onRetry={() => void state.refetch()}
      refreshing={state.isFetching && !state.isLoading}
      onRefresh={() => void state.refetch()}
    >
      <ScreenHeader
        title={room?.name ?? 'Pièce'}
        subtitle={`${activeCount} actif${activeCount > 1 ? 's' : ''} · ${devices.length} appareil${devices.length > 1 ? 's' : ''}`}
        onBack={() => router.back()}
        right={
          <IconButton
            icon={<Pencil size={18} color={t.text} strokeWidth={iconStroke} />}
            accessibilityLabel="Modifier la pièce"
            onPress={() => router.navigate(`/room-form?id=${id}`)}
          />
        }
      />

      {/* Action groupée de la maquette : « Tout éteindre dans salon 3/3 ». */}
      {switchable.length > 0 && (
        <Card
          tint={activeCount > 0 ? 'energy' : 'none'}
          onPress={() => {
            const target = activeCount > 0 ? false : true;
            for (const device of switchable) send(device.id, { type: 'on_off', value: target });
          }}
          accessibilityLabel={activeCount > 0 ? 'Tout éteindre' : 'Tout allumer'}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md - 4 }}
        >
          <Power
            size={22}
            color={activeCount > 0 ? t.energy : t.textSecondary}
            strokeWidth={iconStroke}
          />
          <Txt variant="bodyStrong" style={{ flex: 1 }}>
            {activeCount > 0 ? `Tout éteindre dans ${room?.name ?? 'la pièce'}` : 'Tout allumer'}
          </Txt>
          <Txt variant="data" tone={activeCount > 0 ? 'energy' : 'secondary'}>
            {activeCount}/{switchable.length}
          </Txt>
        </Card>
      )}

      {devices.length === 0 ? (
        <EmptyState
          icon={roomIcons[(room?.icon as RoomKind) ?? 'autre'] ?? deviceIcons.light}
          title="Aucun appareil dans cette pièce"
          actionLabel="Voir tous les appareils"
          onAction={() => router.navigate('/(tabs)/devices')}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {devices.map((device) => {
            const brightness = device.capabilities.find((c) => c.type === 'brightness');
            const level =
              brightness?.value?.type === 'brightness' ? brightness.value.value : null;

            return (
              <View key={device.id} style={{ gap: space.sm }}>
                <DeviceRow
                  {...toDeviceRow(device, {
                    onValueChange: (value) => send(device.id, { type: 'on_off', value }),
                    onPress: () => router.navigate(`/device/${device.id}`),
                  })}
                />
                {/* Curseur inline sous la ligne, comme sur la maquette : régler
                    la luminosité ne doit pas obliger à changer d'écran. */}
                {brightness?.schema.writable && level !== null && isOn(device) && (
                  <LevelSlider
                    value={level}
                    min={brightness.schema.min ?? 1}
                    onCommit={(value) => send(device.id, { type: 'brightness', value })}
                    accessibilityLabel={`Luminosité de ${device.name}`}
                    style={{ marginHorizontal: space.sm }}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function isOn(device: Device): boolean {
  const value = device.capabilities.find((c) => c.type === 'on_off')?.value;
  return value?.type === 'on_off' && value.value && device.online;
}

function writable(device: Device, type: string): boolean {
  return device.capabilities.some((c) => c.type === type && c.schema.writable);
}
