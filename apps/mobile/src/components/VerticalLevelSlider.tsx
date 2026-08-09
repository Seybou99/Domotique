import React, { useCallback, useEffect, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Sun } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { iconStroke, radius, space } from '../theme/tokens';

/**
 * Variante verticale du curseur (écran 2.2 « Détail d'un appareil »).
 * Le remplissage monte depuis le bas : la métaphore physique d'un niveau
 * lumineux se lit mieux verticalement sur un écran de détail.
 */
export type VerticalLevelSliderProps = {
  value: number;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  tone?: 'energy' | 'network';
  disabled?: boolean;
  height?: number;
  unit?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

export function VerticalLevelSlider({
  value,
  onChange,
  onCommit,
  tone = 'energy',
  disabled,
  height = 320,
  unit = '%',
  accessibilityLabel,
  style,
}: VerticalLevelSliderProps) {
  const t = useTheme();
  const fill = tone === 'energy' ? t.energy : t.network;

  const h = useSharedValue(height);
  const progress = useSharedValue(clamp(value) / 100);
  const dragging = useSharedValue(0);
  const [shown, setShown] = useState(Math.round(value));

  useEffect(() => {
    if (!dragging.value) {
      progress.value = clamp(value) / 100;
      setShown(Math.round(value));
    }
  }, [value, progress, dragging]);

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
      progress.value = fromY(e.y, h.value);
      runOnJS(report)(Math.round(progress.value * 100));
    })
    .onUpdate((e) => {
      progress.value = fromY(e.y, h.value);
      runOnJS(report)(Math.round(progress.value * 100));
    })
    .onFinalize(() => {
      dragging.value = 0;
      runOnJS(commit)(Math.round(progress.value * 100));
    });

  const fillStyle = useAnimatedStyle(() => ({ height: `${progress.value * 100}%` }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(e) => {
          h.value = e.nativeEvent.layout.height;
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: shown }}
        style={[
          {
            height,
            borderRadius: radius.card,
            backgroundColor: t.track,
            overflow: 'hidden',
            opacity: disabled ? 0.4 : 1,
          },
          style,
        ]}
      >
        <Animated.View
          style={[
            { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: fill },
            fillStyle,
          ]}
        />
        <View
          pointerEvents="none"
          style={{ flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: space.md }}
        >
          <Sun size={22} color={shown > 84 ? t.onEnergy : t.text} strokeWidth={iconStroke} />
          <Txt variant="data" tone={shown > 8 ? 'onEnergy' : 'primary'}>
            {shown}
            {unit ? ` ${unit}` : ''}
          </Txt>
        </View>
      </View>
    </GestureDetector>
  );
}

function clamp(v: number) {
  return Math.min(100, Math.max(0, v));
}

function fromY(y: number, height: number) {
  'worklet';
  return Math.min(1, Math.max(0, 1 - y / height));
}
