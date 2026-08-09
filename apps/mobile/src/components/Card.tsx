import React from 'react';
import { Pressable, View, type PressableProps, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

/**
 * Surface de base. Pas d'ombre portée (doc §4) : la profondeur vient uniquement
 * d'une variation de luminosité de surface, complétée d'un liseré à 7 %.
 */
export type CardProps = {
  children?: React.ReactNode;
  /** `raised` pour une carte imbriquée dans une autre carte. */
  level?: 'surface' | 'raised' | 'sunken';
  /** Teinte de fond quand la carte représente un objet actif. */
  tint?: 'none' | 'energy' | 'network' | 'danger' | 'success';
  padding?: number;
  radius?: number;
  bordered?: boolean;
  style?: ViewStyle | ViewStyle[];
  onPress?: PressableProps['onPress'];
  onLongPress?: PressableProps['onLongPress'];
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function Card({
  children,
  level = 'surface',
  tint = 'none',
  padding = space.md,
  radius: r = radius.card,
  bordered = true,
  style,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
}: CardProps) {
  const t = useTheme();

  const bg = { surface: t.surface, raised: t.surfaceRaised, sunken: t.surfaceSunken }[level];
  const tintBg = {
    none: undefined,
    energy: t.energySoft,
    network: t.networkSoft,
    danger: t.dangerSoft,
    success: t.successSoft,
  }[tint];
  const tintBorder = {
    none: undefined,
    energy: t.energyRing,
    network: t.networkRing,
    danger: t.danger,
    success: t.success,
  }[tint];

  const base: ViewStyle = {
    backgroundColor: tintBg ?? bg,
    borderRadius: r,
    padding,
    borderWidth: bordered ? 1 : 0,
    borderColor: tintBorder ?? t.line,
  };

  if (!onPress && !onLongPress) {
    return <View style={[base, style]}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [base, pressed && { opacity: 0.85 }, style]}
    >
      {children}
    </Pressable>
  );
}
