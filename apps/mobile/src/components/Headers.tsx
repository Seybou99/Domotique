import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { iconStroke, space } from '../theme/tokens';

/**
 * En-tête de section à l'intérieur d'un écran (« Scènes / Tout voir »,
 * « Pièces / Réorganiser » — écran 1.1).
 *
 * L'action est un lien texte, jamais un bouton plein : sur le tableau de bord,
 * le seul aplat ambre autorisé est celui d'un appareil ou d'une scène en cours.
 */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md },
        style,
      ]}
    >
      <Txt variant="card" numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}
      </Txt>
      {actionLabel && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Txt variant="micro" tone="secondary">
            {actionLabel}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

/**
 * En-tête d'écran de détail (écrans 1.2, 2.2, 1.4).
 *
 * `title` est en `numberOfLines={1}` + `adjustsFontSizeToFit` : les maquettes
 * montrent « Maison des Lilas » tronqué sur deux lignes, ce qu'on corrige ici
 * plutôt que de le reproduire.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.md - 4, minHeight: 44 }, style]}
    >
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={8}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.surfaceRaised,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <ArrowLeft size={20} color={t.text} strokeWidth={iconStroke} />
        </Pressable>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="section" numberOfLines={1} tight adjustsFontSizeToFit minimumFontScale={0.8}>
          {title}
        </Txt>
        {subtitle && (
          <Txt variant="dataMicro" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Txt>
        )}
      </View>
      {right}
    </View>
  );
}
