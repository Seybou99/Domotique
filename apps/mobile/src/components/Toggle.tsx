import React, { useEffect } from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { HIT_SLOP_MIN, motion, radius } from '../theme/tokens';

const W = 56;
const H = 32;
const KNOB = 26;
const PAD = (H - KNOB) / 2;

/**
 * Bascule on/off.
 *
 * Doc §5 : « le changement visuel doit précéder la confirmation réseau ».
 * Le composant est donc piloté par l'état optimiste de l'appelant et bascule
 * immédiatement. Si la commande n'est pas confirmée sous 400 ms, l'appelant
 * passe `pending` et la piste se désature discrètement — sans jamais revenir
 * en arrière tant que l'échec n'est pas avéré.
 *
 * Doc §13 : ambre à l'état actif pour l'éclairage, sarcelle pour les prises.
 */
export type ToggleProps = {
  value: boolean;
  onValueChange?: (v: boolean) => void;
  tone?: 'energy' | 'network';
  disabled?: boolean;
  /** Commande envoyée, pas encore confirmée par l'appareil. */
  pending?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

export function Toggle({
  value,
  onValueChange,
  tone = 'energy',
  disabled,
  pending,
  accessibilityLabel,
  style,
}: ToggleProps) {
  const t = useTheme();
  const p = useSharedValue(value ? 1 : 0);
  const on = tone === 'energy' ? t.energy : t.network;

  useEffect(() => {
    p.value = withTiming(value ? 1 : 0, {
      duration: motion.transition,
      easing: Easing.out(Easing.quad),
    });
  }, [value, p]);

  const trackColors = useDerivedValue(() => [t.track, on]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], trackColors.value),
    opacity: disabled ? 0.4 : pending ? 0.55 : 1,
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: p.value * (W - KNOB - PAD * 2) },
      { scale: withTiming(pending ? 0.78 : 1, { duration: motion.transition }) },
    ],
  }));

  return (
    <Pressable
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled, busy: pending }}
      accessibilityLabel={accessibilityLabel}
      // La piste fait 32 px de haut : on complète jusqu'à la cible de 44 px (doc §15).
      hitSlop={(HIT_SLOP_MIN - H) / 2}
      style={style}
    >
      <Animated.View
        style={[
          { width: W, height: H, borderRadius: radius.pill, padding: PAD, justifyContent: 'center' },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            { width: KNOB, height: KNOB, borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
            knobStyle,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
