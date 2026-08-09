import React from 'react';
import { Pressable, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { DeviceAvatar } from './DeviceAvatar';
import { StatusChip, ProtocolBadge } from './Chip';
import { Toggle } from './Toggle';
import { Txt } from './Txt';
import { radius, space } from '../theme/tokens';

/**
 * Ligne d'appareil — brique la plus dense de l'app (écrans 1.2, 2.1).
 *
 * Trois formes de contrôle en fin de ligne, mutuellement exclusives :
 *  - `toggle`   : capacité on_off
 *  - `status`   : capteur (lecture seule) → puce de statut
 *  - `none`     : la ligne entière est cliquable vers le détail
 *
 * La métadonnée (protocole, niveau, pièce) est en mono : c'est de la donnée
 * technique, pas du texte courant (doc §3).
 */
export type DeviceRowProps = {
  icon: LucideIcon;
  name: string;
  /** Ex. « 62 % », « allumé », « pile 87 % ». */
  meta?: string;
  protocol?: string;
  room?: string;
  online?: boolean;
  tone?: 'energy' | 'network';
  value?: boolean;
  onValueChange?: (v: boolean) => void;
  pending?: boolean;
  status?: { label: string; tone?: 'online' | 'offline' | 'alert' | 'success' | 'energy' };
  onPress?: () => void;
  level?: 'surface' | 'raised';
};

export function DeviceRow({
  icon,
  name,
  meta,
  protocol,
  room,
  online = true,
  tone = 'energy',
  value,
  onValueChange,
  pending,
  status,
  onPress,
  level = 'raised',
}: DeviceRowProps) {
  const t = useTheme();
  const active = !!value && online;

  const metaParts = [protocol, meta, room].filter(Boolean) as string[];

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name}${meta ? `, ${meta}` : ''}${online ? '' : ', hors ligne'}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md - 4,
        padding: space.sm + 4,
        borderRadius: radius.control + 2,
        backgroundColor: level === 'raised' ? t.surfaceRaised : t.surface,
        borderWidth: 1,
        borderColor: active ? (tone === 'energy' ? t.energyRing : t.networkRing) : t.line,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <DeviceAvatar icon={icon} size={40} active={active} online={online} tone={tone} />

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1} tone={online ? 'primary' : 'secondary'}>
          {name}
        </Txt>
        {metaParts.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm - 2 }}>
            {protocol && <ProtocolBadge protocol={protocol} />}
            <Txt variant="dataMicro" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {[meta, room].filter(Boolean).join(' · ')}
            </Txt>
          </View>
        )}
      </View>

      {!online ? (
        <StatusChip label="Hors ligne" tone="offline" />
      ) : status ? (
        <StatusChip label={status.label} tone={status.tone ?? 'online'} />
      ) : onValueChange ? (
        <Toggle
          value={!!value}
          onValueChange={onValueChange}
          tone={tone}
          pending={pending}
          accessibilityLabel={name}
        />
      ) : null}
    </Pressable>
  );
}
