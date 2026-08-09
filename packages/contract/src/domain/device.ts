import { z } from 'zod';
import { isoDateTime, uuid } from '../primitives.js';
import { capabilityState, type CapabilityType } from './capability.js';

/**
 * Appareils et boîtiers (CDC §4, §6).
 */

export const protocol = z.enum(['zigbee', 'tuya', 'hue', 'tapo']);
export type Protocol = z.infer<typeof protocol>;

/** Type d'appareil — pilote le choix d'icône côté app, pas le comportement. */
export const deviceKind = z.enum([
  'light',
  'lamp',
  'plug',
  'contact',
  'leak',
  'thermostat',
  'cover',
  'fan',
  'lock',
]);
export type DeviceKind = z.infer<typeof deviceKind>;

/**
 * Provenance réelle de l'appareil, décomposée (le CDC v1.1 la laissait informe).
 *
 * `third_party_account_id` est indispensable : sans lui, on ne sait pas quels
 * appareils retirer quand un foyer déconnecte son compte Tuya (écran 5.3).
 *
 * `external_id` est un opaque côté app : elle l'affiche en diagnostic (écran 2.2
 * « Identifiant : 0x0001a3f ») mais ne l'interprète jamais.
 */
export const deviceSource = z.object({
  protocol,
  external_id: z.string().min(1).max(128),
  /** Renseigné pour les protocoles cloud, `null` pour Zigbee local. */
  third_party_account_id: uuid.nullable().default(null),
  /** Renseigné pour Zigbee, `null` pour les protocoles cloud. */
  device_unit_id: uuid.nullable().default(null),
});
export type DeviceSource = z.infer<typeof deviceSource>;

export const device = z.object({
  id: uuid,
  home_id: uuid,
  room_id: uuid.nullable().default(null),
  name: z.string().min(1).max(60),
  kind: deviceKind,
  source: deviceSource,
  online: z.boolean(),
  last_seen: isoDateTime.nullable(),
  /** Capacités exposées par l'appareil, dans l'ordre d'affichage. */
  capabilities: z.array(capabilityState),
});
export type Device = z.infer<typeof device>;

/** Accès ponctuel à une capacité — évite un `find` recopié partout. */
export function getCapability(d: Device, type: CapabilityType) {
  return d.capabilities.find((c) => c.type === type) ?? null;
}

/**
 * Boîtier (CDC §4).
 *
 * `certificate_expires_at` est exposé volontairement : sans renouvellement, un
 * certificat expiré déconnecte le boîtier définitivement. L'app peut ainsi
 * prévenir avant la panne, et le support voir venir le problème (écran 2.9).
 */
export const deviceUnit = z.object({
  id: uuid,
  home_id: uuid,
  /** Identifiant gravé sur le boîtier, repris dans le QR code. */
  serial: z.string().min(6).max(64),
  name: z.string().min(1).max(60),
  online: z.boolean(),
  last_heartbeat: isoDateTime.nullable(),
  agent_version: z.string().max(32).nullable().default(null),
  certificate_expires_at: isoDateTime.nullable(),
  /** Nombre d'appareils Zigbee rattachés à ce boîtier. */
  device_count: z.number().int().nonnegative(),
});
export type DeviceUnit = z.infer<typeof deviceUnit>;

/** État du mode association Zigbee (écran 2.5). */
export const pairingSession = z.object({
  device_unit_id: uuid,
  /** Le `permit_join` expire seul — l'app affiche le décompte. */
  expires_at: isoDateTime,
  /** Appareils détectés depuis l'ouverture de la fenêtre. */
  discovered: z.array(
    z.object({
      external_id: z.string(),
      suggested_name: z.string(),
      kind: deviceKind,
      /** Déjà importé dans le foyer ? */
      claimed: z.boolean(),
    }),
  ),
});
export type PairingSession = z.infer<typeof pairingSession>;
