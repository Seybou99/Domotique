import React from 'react';
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { HIT_SLOP_MIN, radius, space } from '../theme/tokens';

/**
 * Boutons.
 *
 * `primary` est ambre plein : c'est le CTA du produit (doc §2). Un seul par écran.
 * `danger` n'est jamais utilisé pour une action de confort — uniquement pour
 * supprimer un appareil, retirer un boîtier, déconnecter un compte tiers.
 */
export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  full,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress?: () => void;
  variant?: BtnVariant;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const t = useTheme();

  const spec = {
    primary: { bg: t.energy, border: 'transparent', fg: t.onEnergy },
    secondary: { bg: t.surfaceRaised, border: t.lineStrong, fg: t.text },
    ghost: { bg: 'transparent', border: 'transparent', fg: t.textSecondary },
    danger: { bg: t.dangerSoft, border: t.danger, fg: t.danger },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={({ pressed }) => [
        {
          minHeight: HIT_SLOP_MIN + 8,
          alignSelf: full ? 'stretch' : 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm + 2,
          paddingHorizontal: space.lg,
          borderRadius: radius.control,
          backgroundColor: spec.bg,
          borderWidth: 1,
          borderColor: spec.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={spec.fg} /> : icon}
      <Txt variant="bodyStrong" style={{ color: spec.fg }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Bouton d'action rond (le « + » ambre des en-têtes Appareils / Scénarios). */
export function IconButton({
  icon,
  onPress,
  variant = 'secondary',
  size = 44,
  accessibilityLabel,
  style,
}: {
  icon: React.ReactNode;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: number;
  accessibilityLabel: string;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = { primary: t.energy, secondary: t.surfaceRaised, ghost: 'transparent' }[variant];
  const border = { primary: 'transparent', secondary: t.lineStrong, ghost: 'transparent' }[variant];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={Math.max(0, (HIT_SLOP_MIN - size) / 2)}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
}

/** Séparateur d'1 px, utilisé dans les listes d'informations techniques. */
export function Divider({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.line }, style]} />;
}
