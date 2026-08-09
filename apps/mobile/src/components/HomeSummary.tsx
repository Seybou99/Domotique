import React from 'react';
import { View } from 'react-native';
import { Lightbulb } from 'lucide-react-native';
import { Card } from './Card';
import { Divider } from './Button';
import { StatusChip } from './Chip';
import { BreathingRing } from './BreathingRing';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { iconStroke, space } from '../theme/tokens';

/**
 * Hero du tableau de bord (écran 1.1).
 *
 * Deux informations seulement, et elles portent chacune un accent différent —
 * c'est la démonstration littérale de la charte : l'ambre pour ce qui consomme,
 * la sarcelle pour ce qui est connecté (doc §1.1).
 */
export function HomeSummary({
  activeDevices,
  totalDevices,
  energyToday,
  hubOnline,
}: {
  activeDevices: number;
  totalDevices: number;
  /** kWh du jour, déjà formaté (« 4,2 »). */
  energyToday: string;
  hubOnline: boolean;
}) {
  const t = useTheme();
  const someActive = activeDevices > 0;

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="screen" tight tone="primary">
            {activeDevices}
          </Txt>
          <Txt variant="caption" tone="secondary" numberOfLines={1}>
            {activeDevices === 1 ? 'appareil allumé' : 'appareils allumés'} sur {totalDevices}
          </Txt>
        </View>
        <BreathingRing size={56} active={someActive} online tone="energy">
          <Lightbulb
            size={24}
            color={someActive ? t.energy : t.textSecondary}
            strokeWidth={iconStroke}
            fill={someActive ? t.energySoft : 'none'}
          />
        </BreathingRing>
      </View>

      <Divider />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        <Txt variant="data" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
          <Txt variant="data" tone="energy">
            {energyToday} kWh
          </Txt>
          {'  aujourd’hui'}
        </Txt>
        <StatusChip
          label={hubOnline ? 'boîtier en ligne' : 'boîtier hors ligne'}
          tone={hubOnline ? 'online' : 'offline'}
        />
      </View>
    </Card>
  );
}
