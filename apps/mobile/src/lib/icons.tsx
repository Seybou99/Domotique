import React from 'react';
import {
  Bed,
  Bell,
  Blinds,
  Clapperboard,
  DoorOpen,
  Droplet,
  Fan,
  Home,
  LampDesk,
  Lightbulb,
  LogOut,
  Lock,
  Moon,
  Plug,
  Router,
  Sofa,
  Square,
  Sunrise,
  Thermometer,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react-native';
import { iconStroke } from '../theme/tokens';

/**
 * Doc §4 : « trait fin (1,5 px), style outline au repos, rempli en état actif —
 * jamais de style mixte sur un même écran ». Lucide n'a pas de variante pleine :
 * l'état actif est rendu par `fill` + un fond teinté, pas par un second jeu d'icônes.
 */

/** Type d'appareil → icône. Aligné sur les capacités du backend, pas sur la marque. */
export const deviceIcons = {
  light: Lightbulb,
  lamp: LampDesk,
  plug: Plug,
  contact: Square,
  leak: Droplet,
  thermostat: Thermometer,
  cover: Blinds,
  fan: Fan,
  lock: Lock,
  hub: Router,
} satisfies Record<string, LucideIcon>;

export type DeviceKind = keyof typeof deviceIcons;

export const roomIcons = {
  salon: Sofa,
  cuisine: UtensilsCrossed,
  chambre: Bed,
  bureau: LampDesk,
  entree: DoorOpen,
  autre: Home,
} satisfies Record<string, LucideIcon>;

export type RoomKind = keyof typeof roomIcons;

export const sceneIcons = {
  cinema: Clapperboard,
  nuit: Moon,
  depart: LogOut,
  reveil: Sunrise,
  alerte: Bell,
} satisfies Record<string, LucideIcon>;

export type SceneKind = keyof typeof sceneIcons;

/**
 * `fill` attend une couleur *translucide* (energySoft / networkSoft), pas l'accent
 * plein : remplir au trait rendrait la silhouette illisible en 20 px.
 */
export function renderIcon(Icon: LucideIcon, size: number, color: string, fill: string = 'none') {
  return <Icon size={size} color={color} strokeWidth={iconStroke} fill={fill} />;
}
