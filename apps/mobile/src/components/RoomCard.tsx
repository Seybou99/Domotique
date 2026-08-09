import React from 'react';
import { View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Card } from './Card';
import { DeviceAvatar } from './DeviceAvatar';
import { Txt } from './Txt';
import { space } from '../theme/tokens';

/**
 * Carte de pièce du tableau de bord (écran 1.1).
 *
 * Le ratio « actifs / total » est en mono et à droite de l'icône : c'est le
 * chiffre que l'utilisateur balaie sur une grille de 6 cartes. Le breathing ring
 * s'active dès qu'au moins un appareil de la pièce est actif (doc §13).
 */
export function RoomCard({
  icon,
  name,
  activeCount,
  totalCount,
  online = true,
  onPress,
}: {
  icon: LucideIcon;
  name: string;
  activeCount: number;
  totalCount: number;
  online?: boolean;
  onPress?: () => void;
}) {
  const active = activeCount > 0 && online;

  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${name}, ${activeCount} appareils actifs sur ${totalCount}`}
      style={{ flex: 1, gap: space.lg, minHeight: 132, justifyContent: 'space-between' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <DeviceAvatar icon={icon} size={40} active={active} online={online} tone="energy" />
        <Txt variant="dataMicro" tone={active ? 'energy' : 'secondary'}>
          {activeCount}/{totalCount} actifs
        </Txt>
      </View>
      <Txt variant="bodyStrong" numberOfLines={1}>
        {name}
      </Txt>
    </Card>
  );
}
