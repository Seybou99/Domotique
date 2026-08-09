import React, { useMemo, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import type {
  AutomationAction,
  AutomationTrigger,
  Device,
  SceneIcon,
} from '@domotique/contract';
import { Button, Card, Divider, ScreenHeader, Toggle, Txt } from '../src/components';
import { Screen, messageFor } from '../src/screens/shared';
import { renderIcon, sceneIcons } from '../src/lib/icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { font, fontSize, iconStroke, radius, space } from '../src/theme/tokens';
import { useHome } from '../src/api/HomeProvider';
import { useAutomationMutations, useAutomations, useHomeState } from '../src/api/hooks';

/**
 * Écrans 3.2 à 3.5 — Création et modification d'un scénario.
 *
 * Le parcours de la maquette est en quatre temps (déclencheur, conditions,
 * actions, résumé). Il est ici replié en un seul écran découpé en sections : sur
 * un scénario à deux actions, quatre écrans successifs coûtent plus qu'ils
 * n'aident. Le résumé reste en dernier, avant l'enregistrement.
 *
 * La relecture en langage naturel n'est pas reconstruite ici : elle vient du
 * serveur après enregistrement, seul à savoir ce qui sera réellement exécuté.
 */
const ICONS: SceneIcon[] = ['cinema', 'nuit', 'depart', 'reveil', 'alerte'];
const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type TriggerKind = 'manual' | 'schedule';

export default function ScenarioForm() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { home } = useHome();
  const state = useHomeState(home?.id);
  const automations = useAutomations(home?.id);
  const mutations = useAutomationMutations(home?.id);

  const existing = automations.data?.find((a) => a.id === id);
  const isEdit = Boolean(existing);

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState<SceneIcon>(existing?.icon ?? 'cinema');
  const [kind, setKind] = useState<TriggerKind>(
    existing?.trigger.kind === 'schedule' ? 'schedule' : 'manual',
  );
  const [time, setTime] = useState(
    existing?.trigger.kind === 'schedule' ? existing.trigger.at : '20:00',
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    existing?.trigger.kind === 'schedule' ? existing.trigger.weekdays : [],
  );
  const [actions, setActions] = useState<AutomationAction[]>(existing?.actions ?? []);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const devices = useMemo(
    () =>
      (state.data?.devices ?? [])
        .filter((device) => device.capabilities.some((c) => c.schema.writable))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [state.data],
  );
  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const canSave =
    name.trim().length > 0 && actions.length > 0 && (kind === 'manual' || timeValid);

  async function submit() {
    setError(null);
    const trigger: AutomationTrigger =
      kind === 'manual' ? { kind: 'manual' } : { kind: 'schedule', at: time, weekdays };

    try {
      if (isEdit && existing) {
        await mutations.update.mutateAsync({
          id: existing.id,
          name: name.trim(),
          icon,
          trigger,
          conditions: [],
          actions,
          enabled,
        });
      } else {
        await mutations.create.mutateAsync({
          name: name.trim(),
          icon,
          trigger,
          conditions: [],
          actions,
          enabled,
        });
      }
      router.back();
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  function confirmDelete() {
    if (!existing) return;
    Alert.alert(`Supprimer « ${existing.name} » ?`, 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          mutations.remove
            .mutateAsync(existing.id)
            .then(() => router.back())
            .catch((caught: unknown) => setError(messageFor(caught))),
      },
    ]);
  }

  return (
    <Screen isLoading={state.isLoading || automations.isLoading}>
      <ScreenHeader
        title={isEdit ? 'Modifier le scénario' : 'Nouveau scénario'}
        onBack={() => router.back()}
      />

      {/* — Identité */}
      <Card style={{ gap: space.md }}>
        <Txt variant="micro" tone="secondary">
          Nom
        </Txt>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Soirée cinéma, Bonne nuit…"
          placeholderTextColor={t.textMuted}
          autoFocus={!isEdit}
          style={inputStyle(t)}
        />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {ICONS.map((key) => {
            const active = icon === key;
            return (
              <Pressable
                key={key}
                onPress={() => setIcon(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: radius.control,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? t.energySoft : t.surfaceRaised,
                  borderWidth: 1,
                  borderColor: active ? t.energyRing : t.line,
                }}
              >
                {renderIcon(sceneIcons[key], 22, active ? t.energy : t.textSecondary)}
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* — Écran 3.2 : déclencheur */}
      <Card style={{ gap: space.md }}>
        <Txt variant="micro" tone="secondary">
          Déclencheur
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Choice label="À la demande" active={kind === 'manual'} onPress={() => setKind('manual')} />
          <Choice label="À une heure" active={kind === 'schedule'} onPress={() => setKind('schedule')} />
        </View>

        {kind === 'schedule' && (
          <>
            <TextInput
              value={time}
              onChangeText={setTime}
              placeholder="20:00"
              placeholderTextColor={t.textMuted}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={[inputStyle(t), { fontFamily: font.mono.regular, width: 120 }]}
            />
            {!timeValid && (
              <Txt variant="dataMicro" tone="danger">
                Format attendu : HH:MM
              </Txt>
            )}
            <Txt variant="dataMicro" tone="muted">
              Heure locale du foyer ({home?.timezone ?? 'Europe/Paris'})
            </Txt>

            <View style={{ flexDirection: 'row', gap: space.sm - 2 }}>
              {JOURS.map((label, index) => {
                const day = index + 1;
                const active = weekdays.includes(day);
                return (
                  <Pressable
                    key={day}
                    onPress={() =>
                      setWeekdays((previous) =>
                        previous.includes(day)
                          ? previous.filter((d) => d !== day)
                          : [...previous, day].sort((a, b) => a - b),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Jour ${day}`}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? t.energy : t.surfaceRaised,
                      borderWidth: 1,
                      borderColor: active ? 'transparent' : t.lineStrong,
                    }}
                  >
                    <Txt variant="micro" style={{ color: active ? t.onEnergy : t.textSecondary }}>
                      {label}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            <Txt variant="dataMicro" tone="muted">
              {weekdays.length === 0 ? 'Tous les jours' : 'Uniquement les jours sélectionnés'}
            </Txt>
          </>
        )}
      </Card>

      {/* — Écran 3.4 : actions, dans l'ordre */}
      <Card style={{ gap: space.md }}>
        <Txt variant="micro" tone="secondary">
          Actions ({actions.length})
        </Txt>

        {actions.length === 0 && (
          <Txt variant="caption" tone="muted">
            Ajoutez au moins une action. Elles seront exécutées dans l’ordre affiché.
          </Txt>
        )}

        {actions.map((action, index) => {
          if (action.kind !== 'set') return null;
          const device = deviceById.get(action.device_id);
          return (
            <View key={`${action.device_id}-${index}`} style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt variant="dataMicro" tone="muted">
                  {index + 1}
                </Txt>
                <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {device?.name ?? 'Appareil supprimé'}
                </Txt>
                <Toggle
                  value={action.target.type === 'on_off' ? action.target.value : true}
                  onValueChange={(value) =>
                    setActions((previous) =>
                      previous.map((item, position) =>
                        position === index
                          ? { ...item, target: { type: 'on_off', value } }
                          : item,
                      ),
                    )
                  }
                  accessibilityLabel={`État de ${device?.name ?? 'l’appareil'}`}
                />
                <Pressable
                  onPress={() =>
                    setActions((previous) => previous.filter((_, position) => position !== index))
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Retirer cette action"
                  hitSlop={8}
                >
                  <Trash2 size={18} color={t.danger} strokeWidth={iconStroke} />
                </Pressable>
              </View>
              {index < actions.length - 1 && <Divider />}
            </View>
          );
        })}

        <Divider />
        <Txt variant="micro" tone="secondary">
          Ajouter un appareil
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {devices
            .filter((device) => !actions.some((a) => a.kind === 'set' && a.device_id === device.id))
            .map((device) => (
              <Pressable
                key={device.id}
                onPress={() =>
                  setActions((previous) => [
                    ...previous,
                    { kind: 'set', device_id: device.id, target: { type: 'on_off', value: true } },
                  ])
                }
                accessibilityRole="button"
                style={{
                  height: 36,
                  justifyContent: 'center',
                  paddingHorizontal: space.md - 4,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: t.lineStrong,
                }}
              >
                <Txt variant="micro" tone="secondary">
                  + {device.name}
                </Txt>
              </Pressable>
            ))}
          {devices.length === 0 && (
            <Txt variant="caption" tone="muted">
              Aucun appareil pilotable dans ce foyer.
            </Txt>
          )}
        </View>
      </Card>

      {/* — Écran 3.5 : relecture avant activation */}
      <Card style={{ gap: space.md }}>
        <Txt variant="micro" tone="secondary">
          Résumé
        </Txt>
        <Txt variant="body">{preview({ name, kind, time, weekdays, actions, deviceById })}</Txt>
        <Divider />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Txt variant="body" style={{ flex: 1 }}>
            Activer le scénario
          </Txt>
          <Toggle value={enabled} onValueChange={setEnabled} accessibilityLabel="Activer" />
        </View>
        {kind === 'manual' && (
          <Txt variant="dataMicro" tone="muted">
            Un scénario à la demande ne se déclenche jamais tout seul — la bascule ne fait que le
            rendre lançable depuis la liste.
          </Txt>
        )}
      </Card>

      {error && (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      )}

      <View style={{ gap: space.sm }}>
        <Button
          label={isEdit ? 'Enregistrer' : 'Créer le scénario'}
          onPress={submit}
          disabled={!canSave}
          loading={mutations.create.isPending || mutations.update.isPending}
          full
        />
        {isEdit && (
          <Button label="Supprimer le scénario" variant="danger" onPress={confirmDelete} full />
        )}
      </View>
    </Screen>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.control,
        backgroundColor: active ? t.energySoft : t.surfaceRaised,
        borderWidth: 1,
        borderColor: active ? t.energyRing : t.line,
      }}
    >
      <Txt variant="micro" tone={active ? 'energy' : 'secondary'}>
        {label}
      </Txt>
    </Pressable>
  );
}

function inputStyle(t: ReturnType<typeof useTheme>) {
  return {
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
}

/**
 * Aperçu local, avant enregistrement.
 *
 * Volontairement approximatif et remplacé par le résumé du serveur dès que le
 * scénario existe : c'est le serveur qui exécute, donc lui seul fait foi.
 */
function preview({
  name,
  kind,
  time,
  weekdays,
  actions,
  deviceById,
}: {
  name: string;
  kind: TriggerKind;
  time: string;
  weekdays: number[];
  actions: AutomationAction[];
  deviceById: Map<string, Device>;
}): string {
  if (actions.length === 0) return 'Ajoutez une action pour voir le résumé.';

  const quand =
    kind === 'manual'
      ? 'À la demande'
      : weekdays.length === 0
        ? `Chaque jour à ${time}`
        : weekdays.join(',') === '1,2,3,4,5'
          ? `En semaine à ${time}`
          : `Certains jours à ${time}`;

  const quoi = actions
    .filter((action): action is Extract<AutomationAction, { kind: 'set' }> => action.kind === 'set')
    .map((action) => {
      const device = deviceById.get(action.device_id)?.name ?? 'un appareil';
      const etat =
        action.target.type === 'on_off' ? (action.target.value ? 'allumé' : 'éteint') : 'réglé';
      return `${device} ${etat}`;
    })
    .join(', ');

  return `${quand}, ${quoi}.${name ? '' : ' (nom manquant)'}`;
}
