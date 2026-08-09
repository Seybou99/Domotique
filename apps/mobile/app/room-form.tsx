import React, { useMemo, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { RoomIcon } from '@domotique/contract';
import { Button, Card, ScreenHeader, Txt } from '../src/components';
import { Screen, messageFor } from '../src/screens/shared';
import { renderIcon, roomIcons } from '../src/lib/icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { font, fontSize, radius, space } from '../src/theme/tokens';
import { useHome } from '../src/api/HomeProvider';
import { useDeviceMutations, useHomeState, useRoomMutations } from '../src/api/hooks';

const ICONS: { key: RoomIcon; label: string }[] = [
  { key: 'salon', label: 'Salon' },
  { key: 'cuisine', label: 'Cuisine' },
  { key: 'chambre', label: 'Chambre' },
  { key: 'bureau', label: 'Bureau' },
  { key: 'entree', label: 'Entrée' },
  { key: 'autre', label: 'Autre' },
];

/**
 * Écran 1.5 — Création et modification d'une pièce.
 *
 * Un seul écran pour les deux : la différence tient au paramètre `id`. Deux
 * écrans quasi identiques divergeraient à la première évolution du formulaire.
 */
export default function RoomForm() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { home } = useHome();
  const state = useHomeState(home?.id);
  const rooms = useRoomMutations(home?.id);
  const devices = useDeviceMutations(home?.id);

  const existing = state.data?.rooms.find((r) => r.id === id);
  const isEdit = Boolean(existing);

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState<RoomIcon>((existing?.icon as RoomIcon) ?? 'salon');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((state.data?.devices ?? []).filter((d) => d.room_id === id).map((d) => d.id)),
  );
  const [error, setError] = useState<string | null>(null);

  // Appareils proposés : ceux de la pièce, plus tous ceux qui n'en ont pas.
  // Déplacer un appareil depuis une autre pièce se fait depuis son détail.
  const candidates = useMemo(() => {
    const all = state.data?.devices ?? [];
    return all
      .filter((device) => !device.room_id || device.room_id === id)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [state.data, id]);

  const busy = rooms.create.isPending || rooms.update.isPending || rooms.remove.isPending;

  async function submit() {
    setError(null);
    try {
      if (isEdit && existing) {
        await rooms.update.mutateAsync({ id: existing.id, name: name.trim(), icon });
        // Le rattachement se fait appareil par appareil : l'API de pièce ne
        // prend la liste qu'à la création.
        const before = new Set(
          (state.data?.devices ?? []).filter((d) => d.room_id === existing.id).map((d) => d.id),
        );
        for (const deviceId of selected) {
          if (!before.has(deviceId)) {
            await devices.update.mutateAsync({ id: deviceId, room_id: existing.id });
          }
        }
        for (const deviceId of before) {
          if (!selected.has(deviceId)) {
            await devices.update.mutateAsync({ id: deviceId, room_id: null });
          }
        }
      } else {
        await rooms.create.mutateAsync({ name: name.trim(), icon, device_ids: [...selected] });
      }
      router.back();
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  function confirmDelete() {
    if (!existing) return;
    Alert.alert(
      `Supprimer « ${existing.name} » ?`,
      'Les appareils de cette pièce ne sont pas supprimés : ils se retrouvent sans pièce.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            rooms.remove
              .mutateAsync(existing.id)
              .then(() => router.back())
              .catch((caught: unknown) => setError(messageFor(caught)));
          },
        },
      ],
    );
  }

  return (
    <Screen isLoading={state.isLoading}>
      <ScreenHeader
        title={isEdit ? 'Modifier la pièce' : 'Nouvelle pièce'}
        onBack={() => router.back()}
      />

      <Card style={{ gap: space.md }}>
        <Txt variant="micro" tone="secondary">
          Nom
        </Txt>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Salon, Cuisine, Chambre…"
          placeholderTextColor={t.textMuted}
          autoFocus={!isEdit}
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
      </Card>

      <Card style={{ gap: space.md }}>
        <Txt variant="micro" tone="secondary">
          Icône
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {ICONS.map(({ key, label }) => {
            const active = icon === key;
            return (
              <Pressable
                key={key}
                onPress={() => setIcon(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={label}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: radius.control,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  backgroundColor: active ? t.energySoft : t.surfaceRaised,
                  borderWidth: 1,
                  borderColor: active ? t.energyRing : t.line,
                }}
              >
                {renderIcon(roomIcons[key], 22, active ? t.energy : t.textSecondary)}
                <Txt variant="dataMicro" tone={active ? 'energy' : 'muted'} style={{ fontSize: 10 }}>
                  {label}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Txt variant="micro" tone="secondary">
          Appareils à rattacher ({selected.size})
        </Txt>
        {candidates.length === 0 ? (
          <Txt variant="caption" tone="muted">
            Tous les appareils sont déjà rattachés à une autre pièce. Vous pourrez les déplacer
            depuis leur fiche.
          </Txt>
        ) : (
          candidates.map((device) => {
            const active = selected.has(device.id);
            return (
              <Pressable
                key={device.id}
                onPress={() =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (next.has(device.id)) next.delete(device.id);
                    else next.add(device.id);
                    return next;
                  })
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm + 2,
                  minHeight: 44,
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
                <Txt variant="body" style={{ flex: 1 }} numberOfLines={1}>
                  {device.name}
                </Txt>
                <Txt variant="dataMicro" tone="muted">
                  {device.source.protocol}
                </Txt>
              </Pressable>
            );
          })
        )}
      </Card>

      {error && (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      )}

      <View style={{ gap: space.sm }}>
        <Button
          label={isEdit ? 'Enregistrer' : 'Créer la pièce'}
          onPress={submit}
          loading={busy}
          disabled={name.trim().length === 0}
          full
        />
        {isEdit && (
          <Button label="Supprimer la pièce" variant="danger" onPress={confirmDelete} full />
        )}
      </View>
    </Screen>
  );
}
