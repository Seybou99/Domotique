import React, { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { motion, radius } from '../theme/tokens';

const ABSOLUTE_FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const;

/**
 * Élément signature du produit (doc §1.2).
 *
 * Un anneau fin qui pulse lentement tant que l'objet est en ligne ET actif.
 * C'est le SEUL élément animé en continu de l'application (doc §5) : ne pas
 * introduire d'autre boucle d'animation ailleurs.
 *
 * Trois états :
 *  - actif + en ligne  → anneau plein + halo qui respire (3 s/cycle)
 *  - en ligne, inactif → anneau discret, immobile
 *  - hors ligne        → anneau gris, aucune pulsation (doc §14)
 *
 * Accessibilité (doc §5, §15) : si « réduire les animations » est actif au niveau
 * système, la pulsation est remplacée par un anneau fixe. L'information n'est
 * jamais portée par la seule animation — le statut est toujours doublé par la
 * couleur ET par un libellé côté appelant.
 */
export type BreathingRingProps = {
  size: number;
  /** L'objet est-il actif (allumé, scène en cours) ? */
  active?: boolean;
  /** Faux = hors ligne : l'anneau s'arrête et passe en gris. */
  online?: boolean;
  /** Ambre pour la lumière/énergie, sarcelle pour le réseau/les prises. */
  tone?: 'energy' | 'network';
  children?: React.ReactNode;
  style?: ViewStyle;
};

export function BreathingRing({
  size,
  active = false,
  online = true,
  tone = 'energy',
  children,
  style,
}: BreathingRingProps) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  const breathing = active && online && !reduceMotion;

  useEffect(() => {
    if (!breathing) {
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: motion.transition });
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: motion.breathDuration, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(progress);
  }, [breathing, progress]);

  const ringColor = !online ? t.track : active ? (tone === 'energy' ? t.energy : t.network) : t.lineStrong;
  const haloColor = tone === 'energy' ? t.energyRing : t.networkRing;

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 0.28 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.75 + progress.value * 0.25,
  }));

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {breathing && (
        <Animated.View
          pointerEvents="none"
          style={[
            ABSOLUTE_FILL,
            {
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: haloColor,
            },
            haloStyle,
          ]}
        />
      )}
      <Animated.View
        pointerEvents="none"
        style={[
          ABSOLUTE_FILL,
          { borderRadius: radius.pill, borderWidth: 1.5, borderColor: ringColor },
          breathing ? ringStyle : undefined,
        ]}
      />
      {children}
    </View>
  );
}
