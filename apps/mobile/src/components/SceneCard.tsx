import React from 'react';
import { View } from 'react-native';
import { Play } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Card } from './Card';
import { Toggle } from './Toggle';
import { Txt } from './Txt';
import { useTheme } from '../theme/ThemeProvider';
import { iconStroke, radius, space } from '../theme/tokens';
import { renderIcon } from '../lib/icons';
import { Pressable } from 'react-native';

/**
 * Tuile de scène compacte du tableau de bord (écran 1.1) — carrousel horizontal.
 * `running` teinte la tuile en ambre le temps de l'exécution.
 */
export function SceneTile({
  icon,
  name,
  running,
  onPress,
}: {
  icon: LucideIcon;
  name: string;
  running?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Card
      onPress={onPress}
      tint={running ? 'energy' : 'none'}
      accessibilityLabel={`Scène ${name}`}
      accessibilityHint="Appuyer pour activer"
      style={{ width: 148, gap: space.lg, justifyContent: 'space-between', minHeight: 110 }}
    >
      {renderIcon(icon, 24, running ? t.energy : t.textSecondary)}
      <Txt variant="bodyStrong" numberOfLines={2} tight>
        {name}
      </Txt>
    </Card>
  );
}

/**
 * Ligne de scène de l'onglet Scénarios (écran 3.1).
 *
 * Deux actions distinctes et volontairement séparées :
 *  - la bascule active/désactive l'automatisation (elle se déclenchera ou non) ;
 *  - « Lancer » exécute la scène tout de suite.
 * Les confondre est l'erreur classique de ce type d'écran.
 */
export function SceneRow({
  icon,
  name,
  trigger,
  enabled,
  onToggle,
  onRun,
  lastRun,
  onPress,
}: {
  icon: LucideIcon;
  name: string;
  /** Ex. « Manuel », « Chaque soir à 23:30 », « En semaine à 06:45 ». */
  trigger: string;
  enabled: boolean;
  onToggle?: (v: boolean) => void;
  onRun?: () => void;
  lastRun?: string;
  onPress?: () => void;
}) {
  const t = useTheme();

  return (
    <Card onPress={onPress} accessibilityLabel={`Scénario ${name}, ${trigger}`} style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md - 4 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: enabled ? t.energySoft : t.surfaceRaised,
            borderWidth: 1,
            borderColor: enabled ? t.energyRing : t.line,
          }}
        >
          {renderIcon(icon, 20, enabled ? t.energy : t.textSecondary)}
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {name}
          </Txt>
          <Txt variant="dataMicro" tone="secondary" numberOfLines={1}>
            {trigger}
          </Txt>
        </View>

        <Toggle
          value={enabled}
          onValueChange={onToggle}
          tone="energy"
          accessibilityLabel={`Activer le scénario ${name}`}
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        <Txt variant="dataMicro" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {lastRun ? `Dernière exécution · ${lastRun}` : 'Jamais exécuté'}
        </Txt>
        <Pressable
          onPress={onRun}
          accessibilityRole="button"
          accessibilityLabel={`Lancer ${name} maintenant`}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm - 2,
            paddingHorizontal: space.md - 4,
            height: 34,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: t.energyRing,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Play size={13} color={t.energy} strokeWidth={iconStroke} fill={t.energy} />
          <Txt variant="micro" tone="energy">
            Lancer
          </Txt>
        </Pressable>
      </View>
    </Card>
  );
}
