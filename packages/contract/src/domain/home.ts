import { z } from 'zod';
import { email, isoDateTime, timezone, uuid } from '../primitives.js';

/**
 * Foyers, membres et pièces (CDC §4).
 *
 * `HomeMember` est une entité à part entière, et non une colonne de `Home` :
 * l'écran 5.2 du design system demande des membres invités **et leurs
 * permissions**, ce qu'une colonne ne peut pas porter.
 */

export const user = z.object({
  id: uuid,
  email,
  display_name: z.string().min(1).max(80),
  avatar_url: z.string().url().nullable().default(null),
  created_at: isoDateTime,
});
export type User = z.infer<typeof user>;

/**
 * Rôles, du plus large au plus restreint.
 *  - `owner`  : un seul par foyer ; seul à pouvoir supprimer le foyer ou en transférer la propriété
 *  - `admin`  : ajoute/retire des appareils, boîtiers et membres
 *  - `member` : pilote les appareils, crée des scénarios
 *  - `guest`  : pilote uniquement, aucune modification de configuration
 */
export const homeRole = z.enum(['owner', 'admin', 'member', 'guest']);
export type HomeRole = z.infer<typeof homeRole>;

export const homeMember = z.object({
  user_id: uuid,
  display_name: z.string(),
  email,
  role: homeRole,
  /** `null` tant que l'invitation n'est pas acceptée. */
  joined_at: isoDateTime.nullable(),
  invited_at: isoDateTime,
});
export type HomeMember = z.infer<typeof homeMember>;

export const home = z.object({
  id: uuid,
  name: z.string().min(1).max(60),
  /** Sert à la météo locale et au fuseau ; jamais renvoyée aux membres non-admin. */
  address: z.string().max(200).nullable().default(null),
  /**
   * Fuseau IANA. Indispensable au planificateur : « chaque soir à 23:30 » n'a
   * aucun sens côté serveur sans lui (CDC §11).
   */
  timezone,
  /** Rôle de l'utilisateur courant dans ce foyer — évite un second appel côté app. */
  my_role: homeRole,
  created_at: isoDateTime,
});
export type Home = z.infer<typeof home>;

/** Icônes de pièce — l'app ne peut afficher que ce jeu (voir src/lib/icons.tsx). */
export const roomIcon = z.enum(['salon', 'cuisine', 'chambre', 'bureau', 'entree', 'autre']);
export type RoomIcon = z.infer<typeof roomIcon>;

/**
 * Pièce — entité à part entière et non un champ texte sur `Device` : les écrans
 * 1.5 (création avec icône) et 1.6 (réorganisation par glisser-déposer) en
 * dépendent.
 */
export const room = z.object({
  id: uuid,
  home_id: uuid,
  name: z.string().min(1).max(40),
  icon: roomIcon,
  /** Ordre d'affichage sur le tableau de bord (écran 1.6). */
  sort_order: z.number().int().nonnegative(),
  /** Dénormalisés pour la carte de pièce de l'écran 1.1 — évite N requêtes. */
  device_count: z.number().int().nonnegative(),
  active_device_count: z.number().int().nonnegative(),
});
export type Room = z.infer<typeof room>;
