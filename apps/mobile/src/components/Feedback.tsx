import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { CloudOff, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { Button } from './Button';
import { Card } from './Card';
import { iconStroke, radius, space } from '../theme/tokens';
import { renderIcon } from '../lib/icons';

/**
 * États systémiques (doc §14).
 *
 * Note de conception : le doc demande des squelettes de chargement, mais aussi
 * (§5) que le breathing ring soit le SEUL élément animé en continu. Nos squelettes
 * sont donc volontairement **statiques**, sans effet de balayage : ils décrivent
 * la structure à venir, ils ne clignotent pas.
 */
export function Skeleton({
  width,
  height = 16,
  radius: r = radius.control,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: r, backgroundColor: t.surfaceRaised }, style]}
    />
  );
}

/** Silhouette d'une carte de pièce, pour le chargement du tableau de bord. */
export function SkeletonCard() {
  return (
    <Card style={{ flex: 1, minHeight: 132, gap: space.lg, justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width={40} height={40} radius={radius.pill} />
        <Skeleton width={56} height={12} />
      </View>
      <Skeleton width="60%" height={16} />
    </Card>
  );
}

/**
 * État vide — doc §14 : « invitation à l'action claire, jamais un simple message
 * neutre ». L'action est donc obligatoire dans la signature.
 */
export function EmptyState({
  icon,
  title,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
      {renderIcon(icon, 32, t.textMuted)}
      <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Button label={actionLabel} variant="secondary" onPress={onAction} />
    </View>
  );
}

/**
 * État d'erreur — doc §14 : « formulation factuelle de ce qui s'est passé et de
 * l'action possible, sans ton d'excuse ». Pas de « Oups », pas de « Désolé ».
 */
export function ErrorState({
  message,
  actionLabel = 'Réessayer',
  onRetry,
}: {
  message: string;
  actionLabel?: string;
  onRetry: () => void;
}) {
  return (
    <Card tint="danger" style={{ gap: space.md }}>
      <Txt variant="body">{message}</Txt>
      <Button label={actionLabel} variant="secondary" onPress={onRetry} />
    </Card>
  );
}

/**
 * Bandeau hors ligne (doc §14) : discret, en tête d'écran, avec le nombre
 * d'appareils concernés. Ne bloque jamais l'interface.
 */
export function OfflineBanner({ count, onPress }: { count: number; onPress?: () => void }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <Card
      onPress={onPress}
      bordered
      padding={space.sm + 4}
      radius={radius.control}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm + 2,
        backgroundColor: t.surfaceRaised,
        borderColor: t.lineStrong,
      }}
    >
      <CloudOff size={18} color={t.textSecondary} strokeWidth={iconStroke} />
      <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
        {count === 1 ? '1 appareil est hors ligne' : `${count} appareils sont hors ligne`}
      </Txt>
    </Card>
  );
}
