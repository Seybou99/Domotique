import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Device } from '@domotique/contract';
import {
  EmptyState,
  HomeSummary,
  OfflineBanner,
  RoomCard,
  SceneTile,
  ScreenHeader,
  SectionHeader,
  Txt,
} from '../../src/components';
import { Screen, ConnectionBanner } from '../../src/screens/shared';
import { roomIcons, sceneIcons, deviceIcons, type RoomKind, type SceneKind } from '../../src/lib/icons';
import { space } from '../../src/theme/tokens';
import { useHome } from '../../src/api/HomeProvider';
import { useAutomations, useHomeState, useRunAutomation } from '../../src/api/hooks';
import { useSession } from '../../src/api/session';

/** Écran 1.1 — Tableau de bord. */
export default function Dashboard() {
  const router = useRouter();
  const { user } = useSession();
  const { home, isLoading: homeLoading } = useHome();
  const state = useHomeState(home?.id);
  const automations = useAutomations(home?.id);
  const run = useRunAutomation(home?.id);

  const stats = useMemo(() => {
    const devices = state.data?.devices ?? [];
    return {
      active: devices.filter(isOn).length,
      total: devices.length,
      offline: devices.filter((d) => !d.online).length,
      energy: devices.reduce((sum, d) => sum + energyOf(d), 0),
      hubOnline: (state.data?.units ?? []).some((u) => u.online),
      hasHub: (state.data?.units ?? []).length > 0,
    };
  }, [state.data]);

  const activeByRoom = useMemo(() => {
    const counts = new Map<string, { active: number; total: number }>();
    for (const device of state.data?.devices ?? []) {
      if (!device.room_id) continue;
      const entry = counts.get(device.room_id) ?? { active: 0, total: 0 };
      entry.total += 1;
      if (isOn(device)) entry.active += 1;
      counts.set(device.room_id, entry);
    }
    return counts;
  }, [state.data]);

  const rooms = state.data?.rooms ?? [];
  const scenes = automations.data ?? [];

  return (
    <Screen
      isLoading={homeLoading || state.isLoading}
      error={state.error}
      onRetry={() => void state.refetch()}
      refreshing={state.isFetching && !state.isLoading}
      onRefresh={() => void state.refetch()}
    >
      <ScreenHeader
        title={home?.name ?? 'Mon foyer'}
        subtitle={greeting(user?.display_name)}
      />

      <ConnectionBanner />
      {stats.offline > 0 && <OfflineBanner count={stats.offline} />}

      <HomeSummary
        activeDevices={stats.active}
        totalDevices={stats.total}
        energyToday={formatEnergy(stats.energy)}
        hubOnline={stats.hasHub ? stats.hubOnline : true}
      />

      {scenes.length > 0 && (
        <View style={{ gap: space.md }}>
          <SectionHeader
            title="Scènes"
            actionLabel="Tout voir"
            onAction={() => router.navigate('/(tabs)/scenarios')}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
          >
            {scenes.slice(0, 6).map((scene) => (
              <SceneTile
                key={scene.id}
                icon={sceneIcons[scene.icon as SceneKind] ?? sceneIcons.cinema}
                name={scene.name}
                running={run.isPending && run.variables === scene.id}
                onPress={() => run.mutate(scene.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      <View style={{ gap: space.md }}>
        <SectionHeader
          title="Pièces"
          actionLabel="Ajouter"
          onAction={() => router.navigate('/room-form')}
        />
        {rooms.length === 0 ? (
          <EmptyState
            icon={deviceIcons.light}
            title="Aucune pièce pour l’instant"
            actionLabel="Créer une pièce"
            onAction={() => router.navigate('/room-form')}
          />
        ) : (
          <View style={{ gap: space.sm }}>
            {chunk(rooms, 2).map((pair, index) => (
              <View key={index} style={{ flexDirection: 'row', gap: space.sm }}>
                {pair.map((room) => {
                  const counts = activeByRoom.get(room.id) ?? { active: 0, total: 0 };
                  return (
                    <RoomCard
                      key={room.id}
                      icon={roomIcons[room.icon as RoomKind] ?? roomIcons.autre}
                      name={room.name}
                      activeCount={counts.active}
                      totalCount={counts.total}
                      onPress={() => router.navigate(`/room/${room.id}`)}
                    />
                  );
                })}
                {/* Cale invisible : sans elle, une carte seule occupe toute la largeur. */}
                {pair.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            ))}
          </View>
        )}
      </View>

      {state.data && stats.total === 0 && (
        <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          Aucun appareil dans ce foyer. Ajoutez-en depuis l’onglet Appareils.
        </Txt>
      )}
    </Screen>
  );
}

function isOn(device: Device): boolean {
  const value = device.capabilities.find((c) => c.type === 'on_off')?.value;
  return value?.type === 'on_off' && value.value && device.online;
}

function energyOf(device: Device): number {
  const value = device.capabilities.find((c) => c.type === 'energy')?.value;
  return value?.type === 'energy' ? value.value : 0;
}

function formatEnergy(value: number): string {
  // Virgule décimale : l'app est en français, le point n'a pas sa place ici.
  return value.toFixed(value < 10 ? 1 : 0).replace('.', ',');
}

function greeting(name: string | undefined): string {
  const hour = new Date().getHours();
  const moment = hour < 6 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
  return name ? `${moment}, ${name}` : moment;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
