import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { font, fontSize, lineHeightRatio } from '../theme/tokens';

/**
 * Toute la typographie de l'app passe par ce composant.
 * Trois familles (doc §3) : display pour les titres et les chiffres clés,
 * body pour le texte courant, mono pour les données techniques.
 */
export type TxtVariant =
  /** 34 — titre d'écran */
  | 'screen'
  /** 28 — titre de section, montants de consommation */
  | 'section'
  /** 22 — titre de carte */
  | 'card'
  /** 17 — corps de texte */
  | 'body'
  /** 17 medium — corps accentué (nom d'appareil dans une liste) */
  | 'bodyStrong'
  /** 15 — légende */
  | 'caption'
  /** 13 — micro-label */
  | 'micro'
  /** 15 mono — valeur de capteur, horodatage */
  | 'data'
  /** 13 mono — identifiant technique, badge de protocole */
  | 'dataMicro';

const VARIANTS: Record<TxtVariant, TextStyle> = {
  screen: { fontFamily: font.display.bold, fontSize: fontSize.screen, letterSpacing: -0.5 },
  section: { fontFamily: font.display.semibold, fontSize: fontSize.section, letterSpacing: -0.3 },
  card: { fontFamily: font.display.semibold, fontSize: fontSize.card, letterSpacing: -0.2 },
  body: { fontFamily: font.body.regular, fontSize: fontSize.body },
  bodyStrong: { fontFamily: font.body.medium, fontSize: fontSize.body },
  caption: { fontFamily: font.body.regular, fontSize: fontSize.caption },
  micro: { fontFamily: font.body.medium, fontSize: fontSize.micro },
  data: { fontFamily: font.mono.regular, fontSize: fontSize.caption },
  dataMicro: { fontFamily: font.mono.regular, fontSize: fontSize.micro, letterSpacing: -0.2 },
};

export type TxtTone = 'primary' | 'secondary' | 'muted' | 'energy' | 'network' | 'success' | 'danger' | 'onEnergy';

export type TxtProps = TextProps & {
  variant?: TxtVariant;
  tone?: TxtTone;
  /** Interlignage serré : pour un titre sur deux lignes. */
  tight?: boolean;
};

export function Txt({ variant = 'body', tone = 'primary', tight, style, ...rest }: TxtProps) {
  const t = useTheme();
  const base = VARIANTS[variant];
  const color = {
    primary: t.text,
    secondary: t.textSecondary,
    muted: t.textMuted,
    energy: t.energy,
    network: t.network,
    success: t.success,
    danger: t.danger,
    onEnergy: t.onEnergy,
  }[tone];

  return (
    <Text
      {...rest}
      style={[
        base,
        { color, lineHeight: Math.round(base.fontSize! * (tight ? 1.15 : lineHeightRatio)) },
        style,
      ]}
    />
  );
}
