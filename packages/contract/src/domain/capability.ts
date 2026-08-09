import { z } from 'zod';
import { isoDateTime, uuid } from '../primitives.js';

/**
 * Capacités — cœur de l'abstraction du CDC §6.
 *
 * Deux notions volontairement séparées (CDC §4 et §6.4) :
 *  - le **schéma** d'une capacité (type, bornes, unité) : statique, écrit au
 *    pairing, vit en PostgreSQL ;
 *  - la **valeur** courante : change en continu, vit en Redis.
 * Le contrat les expose ensemble à l'app, mais ne les confond jamais.
 *
 * Les valeurs sont **normalisées**. Une luminosité vaut 0-100 ici, quelle que
 * soit l'échelle native (Tuya expose 0-1000, Zigbee 0-254). La conversion est la
 * responsabilité du connecteur : si une échelle native traverse cette frontière,
 * la validation Zod la rejette.
 */

export const capabilityType = z.enum([
  // — pilotables
  'on_off',
  'brightness',
  'color_temp',
  'color_hs',
  'position',
  'target_temperature',
  // — lecture seule
  'contact',
  'motion',
  'leak',
  'temperature',
  'humidity',
  'battery',
  'power',
  'energy',
]);
export type CapabilityType = z.infer<typeof capabilityType>;

/** Sous-ensemble pilotable : seules ces capacités peuvent faire l'objet d'une commande. */
export const writableCapabilityType = z.enum([
  'on_off',
  'brightness',
  'color_temp',
  'color_hs',
  'position',
  'target_temperature',
]);
export type WritableCapabilityType = z.infer<typeof writableCapabilityType>;

export const hueSaturation = z.object({
  h: z.number().min(0).max(360),
  s: z.number().min(0).max(100),
});

/**
 * Valeur d'une capacité, en union discriminée sur `type`.
 *
 * C'est la pièce qui donne sa valeur au paquet : impossible d'envoyer un booléen
 * dans `brightness`, ni une chaîne Tuya brute dans `contact`.
 */
export const capabilityValue = z.discriminatedUnion('type', [
  z.object({ type: z.literal('on_off'), value: z.boolean() }),
  /** Pourcentage. 0 n'implique pas éteint : `on_off` reste la source de vérité. */
  z.object({ type: z.literal('brightness'), value: z.number().min(0).max(100) }),
  /** Température de couleur en kelvins (et non en mireds). */
  z.object({ type: z.literal('color_temp'), value: z.number().int().min(1000).max(10000) }),
  z.object({ type: z.literal('color_hs'), value: hueSaturation }),
  /** Ouverture d'un volet : 0 = fermé, 100 = ouvert. */
  z.object({ type: z.literal('position'), value: z.number().min(0).max(100) }),
  /** Consigne en °C. */
  z.object({ type: z.literal('target_temperature'), value: z.number().min(-20).max(60) }),

  z.object({ type: z.literal('contact'), value: z.enum(['open', 'closed']) }),
  z.object({ type: z.literal('motion'), value: z.boolean() }),
  z.object({ type: z.literal('leak'), value: z.enum(['wet', 'dry']) }),
  z.object({ type: z.literal('temperature'), value: z.number().min(-50).max(100) }),
  z.object({ type: z.literal('humidity'), value: z.number().min(0).max(100) }),
  z.object({ type: z.literal('battery'), value: z.number().min(0).max(100) }),
  /** Puissance instantanée en watts. */
  z.object({ type: z.literal('power'), value: z.number().min(0) }),
  /** Énergie cumulée en kWh. */
  z.object({ type: z.literal('energy'), value: z.number().min(0) }),
]);
export type CapabilityValue = z.infer<typeof capabilityValue>;

/** Valeur pilotable — ce qu'une commande peut porter. */
export const writableCapabilityValue = z.discriminatedUnion('type', [
  z.object({ type: z.literal('on_off'), value: z.boolean() }),
  z.object({ type: z.literal('brightness'), value: z.number().min(0).max(100) }),
  z.object({ type: z.literal('color_temp'), value: z.number().int().min(1000).max(10000) }),
  z.object({ type: z.literal('color_hs'), value: hueSaturation }),
  z.object({ type: z.literal('position'), value: z.number().min(0).max(100) }),
  z.object({ type: z.literal('target_temperature'), value: z.number().min(-20).max(60) }),
]);
export type WritableCapabilityValue = z.infer<typeof writableCapabilityValue>;

/** Schéma d'une capacité, tel qu'écrit au pairing. */
export const capabilitySchema = z.object({
  type: capabilityType,
  writable: z.boolean(),
  /** Bornes réelles de l'appareil, dans l'unité normalisée ci-dessus. */
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  /** Pas minimal accepté par l'appareil, si contraint. */
  step: z.number().positive().nullable().default(null),
  unit: z.enum(['%', 'K', '°C', 'W', 'kWh', 'none']).default('none'),
});
export type CapabilitySchema = z.infer<typeof capabilitySchema>;

/**
 * Schéma + dernière valeur connue, tels que servis à l'app.
 *
 * Exposé en **liste** sur `Device`, et non en dictionnaire indexé par type :
 * `z.record` avec une clé énumérée rendrait les 14 capacités obligatoires sur
 * chaque appareil. Une liste porte aussi un ordre d'affichage déterministe.
 */
export const capabilityState = z.object({
  type: capabilityType,
  schema: capabilitySchema,
  /** `null` tant qu'aucune valeur n'a été reçue depuis le pairing. */
  value: capabilityValue.nullable(),
  /** Date de la dernière valeur reçue. */
  updated_at: isoDateTime.nullable(),
});
export type CapabilityState = z.infer<typeof capabilityState>;

/**
 * Origine d'un changement d'état.
 *
 * Requis par l'écran 2.2 du design system, qui affiche « allumé · app » ou
 * « scène Soirée cinéma ». Dans un foyer à plusieurs membres, c'est aussi la
 * seule réponse possible à « qui a éteint le chauffage ? ».
 */
export const changeOrigin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), user_id: uuid, display_name: z.string() }),
  z.object({ kind: z.literal('automation'), automation_id: uuid, name: z.string() }),
  /** Changement physique (interrupteur mural, capteur) remonté par l'appareil. */
  z.object({ kind: z.literal('device') }),
  /** Changement effectué hors plateforme (app Tuya du fabricant, par exemple). */
  z.object({ kind: z.literal('external'), provider: z.string() }),
  z.object({ kind: z.literal('unknown') }),
]);
export type ChangeOrigin = z.infer<typeof changeOrigin>;

/** Une entrée de l'historique d'état (écran 2.2). */
export const stateChange = z.object({
  device_id: uuid,
  capability: capabilityValue,
  origin: changeOrigin,
  at: isoDateTime,
});
export type StateChange = z.infer<typeof stateChange>;
