import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Divider, ScreenHeader, StatusChip, Txt } from '../../src/components';
import { Screen } from '../../src/screens/shared';
import { space } from '../../src/theme/tokens';
import { useSession } from '../../src/api/session';
import { useHome } from '../../src/api/HomeProvider';
import { useHomeState, useUnits } from '../../src/api/hooks';
import { formatDateTime } from '../../src/lib/dates';

/** Onglet 5 — Profil, foyer et boîtiers (écrans 5.1, 5.2, 5.4). */
export default function Profile() {
  const router = useRouter();
  const { user, signOut } = useSession();
  const { home, homes } = useHome();
  const state = useHomeState(home?.id);
  const units = useUnits(home?.id);

  return (
    <Screen isLoading={!user} refreshing={units.isFetching} onRefresh={() => void units.refetch()}>
      <ScreenHeader title="Profil" subtitle={user?.email} />

      <Card style={{ gap: space.sm }}>
        <Txt variant="card">{user?.display_name}</Txt>
        <Txt variant="dataMicro" tone="secondary">
          {user?.email}
        </Txt>
        <Divider />
        <Row label="Foyers" value={String(homes.length)} />
        <Row label="Foyer courant" value={home?.name ?? '—'} />
        <Row label="Rôle" value={roleLabel(home?.my_role)} />
        <Row label="Fuseau" value={home?.timezone ?? '—'} />
      </Card>

      <View style={{ gap: space.md }}>
        <Txt variant="card">Boîtiers</Txt>
        {(units.data?.length ?? 0) === 0 ? (
          <Card>
            <Txt variant="caption" tone="secondary">
              Aucun boîtier associé. Les appareils Zigbee nécessitent un boîtier ;
              les appareils Wi-Fi fonctionnent sans.
            </Txt>
          </Card>
        ) : (
          units.data?.map((unit) => (
            <Card key={unit.id} style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt variant="bodyStrong" style={{ flex: 1 }}>
                  {unit.name}
                </Txt>
                <StatusChip
                  label={unit.online ? 'en ligne' : 'hors ligne'}
                  tone={unit.online ? 'online' : 'offline'}
                />
              </View>
              <Row label="Série" value={unit.serial} />
              <Row label="Appareils" value={String(unit.device_count)} />
              <Row
                label="Dernière synchro"
                value={unit.last_heartbeat ? formatDateTime(unit.last_heartbeat) : 'jamais'}
              />
              {unit.certificate_expires_at && (
                <Row
                  label="Certificat"
                  value={`expire le ${new Date(unit.certificate_expires_at).toLocaleDateString('fr-FR')}`}
                />
              )}
            </Card>
          ))
        )}
      </View>

      <Card style={{ gap: space.sm }}>
        <Row label="Appareils" value={String(state.data?.devices.length ?? 0)} />
        <Row label="Pièces" value={String(state.data?.rooms.length ?? 0)} />
      </Card>

      <View style={{ gap: space.sm }}>
        <Button
          label="Design system"
          variant="secondary"
          onPress={() => router.navigate('/design-system')}
          full
        />
        <Button label="Se déconnecter" variant="danger" onPress={() => void signOut()} full />
      </View>
    </Screen>
  );
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

function roleLabel(role: string | undefined): string {
  switch (role) {
    case 'owner':
      return 'propriétaire';
    case 'admin':
      return 'administrateur';
    case 'member':
      return 'membre';
    case 'guest':
      return 'invité';
    default:
      return '—';
  }
}

