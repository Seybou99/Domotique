import { alpha, palette } from './tokens';

/**
 * Rôles sémantiques. Les composants ne consomment JAMAIS `palette` directement :
 * ils passent par ces rôles, ce qui rend le mode clair (doc §2, prévu V2) purement
 * additif — une seconde table ci-dessous, zéro modification de composant.
 */
export type Theme = {
  name: 'dark' | 'light';
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  line: string;
  lineStrong: string;
  track: string;

  text: string;
  textSecondary: string;
  textMuted: string;

  /** Ambre — lumière, chauffage, consommation, CTA principaux. */
  energy: string;
  energySoft: string;
  energyRing: string;
  onEnergy: string;

  /** Sarcelle — réseau, appareil en ligne, synchronisé. */
  network: string;
  networkSoft: string;
  networkRing: string;

  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;

  scrim: string;
  pressed: string;
};

export const darkTheme: Theme = {
  name: 'dark',
  bg: palette.ink,
  surface: palette.surface,
  surfaceRaised: palette.surfaceRaised,
  surfaceSunken: palette.surfaceSunken,
  line: alpha.hairline,
  lineStrong: alpha.hairlineStrong,
  track: palette.slate,

  text: palette.textPrimary,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,

  energy: palette.amber,
  energySoft: alpha.amberSoft,
  energyRing: alpha.amberRing,
  onEnergy: palette.amberInk,

  network: palette.teal,
  networkSoft: alpha.tealSoft,
  networkRing: alpha.tealRing,

  success: palette.success,
  successSoft: alpha.successSoft,
  danger: palette.danger,
  dangerSoft: alpha.dangerSoft,

  scrim: alpha.scrim,
  pressed: alpha.pressed,
};

/**
 * Mode clair — doc §2 : « inverse la logique avec un fond #F4F6F8 et une surface
 * #FFFFFF, en conservant les deux accents à l'identique ». Les accents sont
 * assombris de quelques points ici uniquement pour tenir le contraste AA du texte
 * sur fond clair ; les aplats (boutons, curseurs) gardent la teinte de la charte.
 */
export const lightTheme: Theme = {
  name: 'light',
  bg: '#F4F6F8',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#EAEEF2',
  line: 'rgba(20, 26, 34, 0.08)',
  lineStrong: 'rgba(20, 26, 34, 0.14)',
  track: '#D7DDE4',

  text: '#141A22',
  textSecondary: '#5A6774',
  textMuted: '#8A96A3',

  energy: palette.amber,
  energySoft: 'rgba(232, 163, 61, 0.16)',
  energyRing: 'rgba(232, 163, 61, 0.38)',
  onEnergy: palette.amberInk,

  network: '#1F8A85',
  networkSoft: 'rgba(47, 165, 160, 0.16)',
  networkRing: 'rgba(47, 165, 160, 0.38)',

  success: '#2F8D5B',
  successSoft: 'rgba(76, 175, 125, 0.16)',
  danger: '#C4392E',
  dangerSoft: 'rgba(226, 87, 76, 0.14)',

  scrim: 'rgba(20, 26, 34, 0.4)',
  pressed: 'rgba(20, 26, 34, 0.05)',
};
