import React from 'react';
import { View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { BreathingRing } from './BreathingRing';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { renderIcon } from '../lib/icons';

/**
 * Pastille d'appareil / de pièce / de scène : icône centrée dans le breathing ring.
 * C'est l'assemblage réutilisé partout (carte de pièce, ligne d'appareil,
 * en-tête de détail), pour que l'anneau de respiration ait exactement le même
 * comportement quel que soit l'écran.
 */
export function DeviceAvatar({
  icon,
  size = 44,
  active = false,
  online = true,
  tone = 'energy',
}: {
  icon: LucideIcon;
  size?: number;
  active?: boolean;
  online?: boolean;
  tone?: 'energy' | 'network';
}) {
  const t = useTheme();
  const accent = tone === 'energy' ? t.energy : t.network;
  const soft = tone === 'energy' ? t.energySoft : t.networkSoft;

  const color = !online ? t.textMuted : active ? accent : t.textSecondary;

  return (
    <BreathingRing size={size} active={active} online={online} tone={tone}>
      <View
        style={{
          width: size - 3,
          height: size - 3,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active && online ? soft : 'transparent',
        }}
      >
        {renderIcon(icon, Math.round(size * 0.45), color, active && online ? soft : 'none')}
      </View>
    </BreathingRing>
  );
}
