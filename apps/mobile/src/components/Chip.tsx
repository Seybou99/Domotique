import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { HIT_SLOP_MIN, radius, space } from '../theme/tokens';

/**
 * Puce de statut (doc §13) — en ligne (sarcelle), hors ligne (gris), alerte (rouge).
 *
 * Doc §15 : « les informations codées par couleur sont toujours doublées d'un
 * libellé ou d'une icône distincte ». Le libellé est donc obligatoire ici, et le
 * point coloré n'est qu'un renfort — jamais l'information seule.
 */
export type StatusTone = 'online' | 'offline' | 'alert' | 'success' | 'energy';

export function StatusChip({
  label,
  tone = 'online',
  dot = true,
  style,
}: {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const color = {
    online: t.network,
    offline: t.textMuted,
    alert: t.danger,
    success: t.success,
    energy: t.energy,
  }[tone];

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm - 2,
          paddingHorizontal: space.sm + 2,
          paddingVertical: space.xs + 1,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: color,
        },
        style,
      ]}
    >
      {dot && <View style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: color }} />}
      <Txt variant="dataMicro" style={{ color }}>
        {label}
      </Txt>
    </View>
  );
}

/**
 * Badge de protocole (Zigbee / Tuya / Hue / Tapo) — doc écran 2.1 : « badge
 * discret ». Volontairement neutre : le protocole est une information de
 * diagnostic, pas une hiérarchie visuelle. Il ne prend jamais l'un des deux
 * accents, qui sont réservés à l'énergie et au réseau.
 */
export function ProtocolBadge({ protocol, style }: { protocol: string; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          paddingHorizontal: space.sm - 1,
          paddingVertical: 2,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: t.lineStrong,
          backgroundColor: t.surfaceSunken,
        },
        style,
      ]}
    >
      <Txt variant="dataMicro" tone="secondary">
        {protocol}
      </Txt>
    </View>
  );
}

/** Puce de filtre (écran 2.1). Sélectionnée = aplat clair, cohérent avec la maquette. */
export function FilterChip({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={(HIT_SLOP_MIN - 34) / 2}
      style={({ pressed }) => [
        {
          height: 34,
          justifyContent: 'center',
          paddingHorizontal: space.md - 2,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: selected ? 'transparent' : t.lineStrong,
          backgroundColor: selected ? t.text : 'transparent',
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Txt variant="micro" style={{ color: selected ? t.bg : t.textSecondary }}>
        {label}
      </Txt>
    </Pressable>
  );
}
