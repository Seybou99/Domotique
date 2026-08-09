import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Search } from 'lucide-react-native';
import type { Device } from '@domotique/contract';
import { DeviceRow, EmptyState, FilterChip, IconButton, ScreenHeader, Txt } from '../../src/components';
import { Screen, ConnectionBanner } from '../../src/screens/shared';
import { toDeviceRow } from '../../src/api/adapters';
import { deviceIcons } from '../../src/lib/icons';
import { useTheme } from '../../src/theme/ThemeProvider';
import { font, fontSize, iconStroke, radius, space } from '../../src/theme/tokens';
import { useHome } from '../../src/api/HomeProvider';
import { useHomeState, useSendCommand } from '../../src/api/hooks';

const FILTERS = ['Tous', 'Éclairage', 'Prises', 'Capteurs', 'Zigbee', 'Cloud'] as const;
type Filter = (typeof FILTERS)[number];

/** Écran 2.1 — Liste complète des appareils. */
export default function Devices() {
  const t = useTheme();
  const router = useRouter();
  const { home } = useHome();
  const state = useHomeState(home?.id);
  const { send } = useSendCommand(home?.id);

  const [filter, setFilter] = useState<Filter>('Tous');
  const [search, setSearch] = useState('');

  const roomNames = useMemo(
    () => new Map((state.data?.rooms ?? []).map((r) => [r.id, r.name])),
    [state.data],
  );

  const devices = useMemo(() => {
    const all = state.data?.devices ?? [];
    const needle = search.trim().toLowerCase();
    return all
      .filter((device) => matches(device, filter))
      .filter((device) => !needle || device.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [state.data, filter, search]);

  return (
    <Screen
      isLoading={state.isLoading}
      error={state.error}
      onRetry={() => void state.refetch()}
      refreshing={state.isFetching && !state.isLoading}
      onRefresh={() => void state.refetch()}
    >
      <ScreenHeader
        title="Appareils"
        subtitle={`${state.data?.devices.length ?? 0} au total`}
        right={
          <IconButton
            icon={<Plus size={22} color={t.onEnergy} strokeWidth={iconStroke} />}
            variant="primary"
            accessibilityLabel="Ajouter un appareil"
            onPress={() => router.navigate('/device-add')}
          />
        }
      />
      <ConnectionBanner />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          height: 48,
          paddingHorizontal: space.md,
          borderRadius: radius.control,
          backgroundColor: t.surfaceSunken,
          borderWidth: 1,
          borderColor: t.lineStrong,
        }}
      >
        <Search size={18} color={t.textMuted} strokeWidth={iconStroke} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher un appareil"
          placeholderTextColor={t.textMuted}
          style={{
            flex: 1,
            color: t.text,
            fontFamily: font.body.regular,
            fontSize: fontSize.caption,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {FILTERS.map((item) => (
          <FilterChip
            key={item}
            label={item}
            selected={filter === item}
            onPress={() => setFilter(item)}
          />
        ))}
      </View>

      {devices.length === 0 ? (
        <EmptyState
          icon={deviceIcons.light}
          title={
            search || filter !== 'Tous'
              ? 'Aucun appareil ne correspond'
              : 'Aucun appareil dans ce foyer'
          }
          actionLabel={search || filter !== 'Tous' ? 'Réinitialiser' : 'Ajouter un appareil'}
          onAction={() => {
            if (search || filter !== 'Tous') {
              setSearch('');
              setFilter('Tous');
            } else {
              router.navigate('/device-add');
            }
          }}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              {...toDeviceRow(device, {
                roomName: device.room_id ? roomNames.get(device.room_id) : undefined,
                onValueChange: (value) => send(device.id, { type: 'on_off', value }),
                onPress: () => router.navigate(`/device/${device.id}`),
              })}
            />
          ))}
        </View>
      )}

      <Txt variant="dataMicro" tone="muted" style={{ textAlign: 'center' }}>
        {devices.length} affiché{devices.length > 1 ? 's' : ''}
      </Txt>
    </Screen>
  );
}

function matches(device: Device, filter: Filter): boolean {
  switch (filter) {
    case 'Tous':
      return true;
    case 'Éclairage':
      return device.kind === 'light' || device.kind === 'lamp';
    case 'Prises':
      return device.kind === 'plug';
    case 'Capteurs':
      // Un capteur est un appareil sans aucune capacité pilotable — c'est le
      // schéma qui le dit, pas une liste de types tenue à la main.
      return !device.capabilities.some((c) => c.schema.writable);
    case 'Zigbee':
      return device.source.protocol === 'zigbee';
    case 'Cloud':
      return device.source.protocol !== 'zigbee';
  }
}
