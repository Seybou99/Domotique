/**
 * Design tokens — « Veille active »
 *
 * Source : design-system-domotique.docx v1.0 + maquettes « App Domotique-selection ».
 *
 * Écart assumé avec le document : le doc ne définit qu'une seule surface élevée
 * (Slate #3A4553). Les maquettes utilisent en réalité trois niveaux de surface
 * nettement plus sombres, et réservent le #3A4553 aux pistes de curseur, bordures
 * et états inactifs. On formalise donc une rampe de surfaces, et Slate devient
 * `line` / `track`. Toutes les autres valeurs sont conformes au document.
 */

export const palette = {
  ink: '#141A22', // fond principal (doc §2)
  surface: '#1C242E', // cartes
  surfaceRaised: '#232D39', // lignes/contrôles imbriqués, feuilles modales
  surfaceSunken: '#10161D', // barre de navigation, champs de saisie
  slate: '#3A4553', // pistes de curseur, bordures, états inactifs

  textPrimary: '#F4F6F8',
  textSecondary: '#9AA6B2',
  textMuted: '#64707E',

  amber: '#E8A33D', // lumière / énergie
  amberInk: '#241A0C', // texte sur aplat ambre
  teal: '#2FA5A0', // réseau / connexion
  success: '#4CAF7D',
  danger: '#E2574C',

  white: '#FFFFFF',
  black: '#000000',
} as const;

/** Voiles translucides — la profondeur vient de la luminosité, jamais d'une ombre (doc §4). */
export const alpha = {
  hairline: 'rgba(244, 246, 248, 0.07)',
  hairlineStrong: 'rgba(244, 246, 248, 0.12)',
  amberSoft: 'rgba(232, 163, 61, 0.14)',
  amberRing: 'rgba(232, 163, 61, 0.32)',
  tealSoft: 'rgba(47, 165, 160, 0.14)',
  tealRing: 'rgba(47, 165, 160, 0.32)',
  dangerSoft: 'rgba(226, 87, 76, 0.14)',
  successSoft: 'rgba(76, 175, 125, 0.14)',
  scrim: 'rgba(10, 14, 18, 0.72)',
  pressed: 'rgba(244, 246, 248, 0.06)',
} as const;

/** Grille de base 8 px (doc §4). */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  card: 20, // cartes principales
  control: 14, // contrôles
  pill: 999, // puces de statut, boutons flottants
} as const;

/** Échelle 34/28/22/17/15/13, interlignage 1.4 (doc §3). */
export const fontSize = {
  screen: 34,
  section: 28,
  card: 22,
  body: 17,
  caption: 15,
  micro: 13,
} as const;

export const lineHeightRatio = 1.4;

export const font = {
  display: {
    semibold: 'SpaceGrotesk_600SemiBold',
    bold: 'SpaceGrotesk_700Bold',
  },
  body: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
  },
  mono: {
    regular: 'JetBrainsMono_400Regular',
    medium: 'JetBrainsMono_500Medium',
  },
} as const;

/** Mouvement (doc §5) — un seul élément animé en continu : le breathing ring. */
export const motion = {
  breathDuration: 3000, // ms par cycle, jamais plus rapide
  transition: 200, // transitions d'écran et de contrôle
  pendingThreshold: 400, // au-delà, on affiche l'état « en cours »
} as const;

/** Cible tactile minimale (doc §15). */
export const HIT_SLOP_MIN = 44;

export const iconStroke = 1.5;
