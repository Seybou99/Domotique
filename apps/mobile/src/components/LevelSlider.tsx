import React, { useCallback, useEffect, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Sun } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { iconStroke, radius, space } from '../theme/tokens';

/**
 * Curseur de niveau (luminosité, température, volume) — doc §13.
 *
 * Piste épaisse (56 px, très au-delà de la cible tactile de 44 px), remplissage
 * plein plutôt que poignée : sur un mur d'appareils, un remplissage se lit d'un
 * coup d'œil là où une poignée de 20 px demande de viser.
 *
 * `onChange` est appelé en continu (retour visuel immédiat, doc §5) et
 * `onCommit` une seule fois au relâchement — c'est lui qui doit déclencher
 * l'appel réseau, pas `onChange`.
 */
export type LevelSliderProps = {
  value: number; // 0..100
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  tone?: 'energy' | 'network';
  disabled?: boolean;
  height?: number;
  icon?: React.ReactNode;
  /** Suffixe affiché après la valeur (« % », « °C »…). */
  unit?: string;
  min?: number;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

export function LevelSlider({
  value,
  onChange,
  onCommit,
  tone = 'energy',
  disabled,
  height = 56,
  icon,
  unit = '%',
  min = 0,
  accessibilityLabel,
  style,
}: LevelSliderProps) {
  const t = useTheme();
  const fill = tone === 'energy' ? t.energy : t.network;

  const width = useSharedValue(0);
  const progress = useSharedValue(clamp(value, min, 100) / 100);
  const dragging = useSharedValue(0);
  const [shown, setShown] = useState(Math.round(value));

  useEffect(() => {
    if (!dragging.value) {
      progress.value = clamp(value, min, 100) / 100;
      setShown(Math.round(value));
    }
  }, [value, min, progress, dragging]);

  const report = useCallback(
    (v: number) => {
      setShown(v);
      onChange?.(v);
    },
    [onChange],
  );

  const commit = useCallback((v: number) => onCommit?.(v), [onCommit]);

  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onBegin((e) => {
      dragging.value = 1;
      progress.value = clampW(e.x / width.value, min / 100);
      runOnJS(report)(Math.round(progress.value * 100));
    })
    .onUpdate((e) => {
      progress.value = clampW(e.x / width.value, min / 100);
      runOnJS(report)(Math.round(progress.value * 100));
    })
    .onFinalize(() => {
      dragging.value = 0;
      runOnJS(commit)(Math.round(progress.value * 100));
    });

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(e) => {
          width.value = e.nativeEvent.layout.width;
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min, max: 100, now: shown }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const next = clamp(shown + (e.nativeEvent.actionName === 'increment' ? 5 : -5), min, 100);
          setShown(next);
          progress.value = next / 100;
          onChange?.(next);
          onCommit?.(next);
        }}
        style={[
          {
            height,
            borderRadius: radius.control,
            backgroundColor: t.track,
            overflow: 'hidden',
            justifyContent: 'center',
            opacity: disabled ? 0.4 : 1,
          },
          style,
        ]}
      >
        <Animated.View
          style={[
            { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: fill },
            fillStyle,
          ]}
        />
        <View
          pointerEvents="none"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: space.md,
          }}
        >
          {/* Le remplissage passe sous ces deux éléments : on inverse leur couleur
              selon qu'ils reposent sur l'aplat d'accent ou sur la piste nue. */}
          {icon ?? <Sun size={20} color={shown < 14 ? t.text : t.onEnergy} strokeWidth={iconStroke} />}
          <Txt variant="data" tone={shown > 86 ? 'onEnergy' : 'primary'}>
            {shown}
            {unit ? ` ${unit}` : ''}
          </Txt>
        </View>
      </View>
    </GestureDetector>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function clampW(v: number, lo: number) {
  'worklet';
  return Math.min(1, Math.max(lo, v));
}
