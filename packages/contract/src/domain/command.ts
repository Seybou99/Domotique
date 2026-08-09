import { z } from 'zod';
import { isoDateTime, uuid } from '../primitives.js';
import { errorCode } from '../primitives.js';
import { writableCapabilityValue } from './capability.js';

/**
 * Commandes (CDC §4).
 *
 * L'identifiant est **généré par l'app**, pas par le serveur : c'est ce qui rend
 * le rejeu sûr après une perte réseau. Renvoyer deux fois la même commande
 * renvoie le même résultat, sans double allumage.
 */

/**
 * Sémantique de l'accusé de réception — diffère par connecteur, et doit être
 * explicite sinon `acked` ne veut pas dire la même chose selon la marque de
 * l'ampoule :
 *
 *  - `device`  : l'appareil lui-même a confirmé (Zigbee via le boîtier)
 *  - `gateway` : le cloud du fabricant a accepté la requête, l'appareil n'a rien
 *                confirmé (Tuya) — la confirmation réelle arrivera plus tard,
 *                par corrélation avec le prochain changement d'état
 *  - `none`    : aucune confirmation possible, la commande est optimiste
 */
export const ackSemantics = z.enum(['device', 'gateway', 'none']);
export type AckSemantics = z.infer<typeof ackSemantics>;

export const commandStatus = z.enum(['pending', 'sent', 'acked', 'timeout', 'failed', 'queued']);
export type CommandStatus = z.infer<typeof commandStatus>;

export const commandRequest = z.object({
  /** UUID v4 généré côté app. Rejouable à l'identique. */
  command_id: uuid,
  /** La capacité visée et sa valeur cible, dans l'unité normalisée du contrat. */
  target: writableCapabilityValue,
});
export type CommandRequest = z.infer<typeof commandRequest>;

export const command = z.object({
  command_id: uuid,
  device_id: uuid,
  target: writableCapabilityValue,
  status: commandStatus,
  ack_semantics: ackSemantics,
  /**
   * Délai au-delà duquel le serveur passera la commande en `timeout`. Propre au
   * connecteur — un aller-retour Zigbee local n'a pas le même ordre de grandeur
   * qu'un appel au cloud Tuya. L'app s'en sert pour son état « en cours », plutôt
   * que d'un délai codé en dur (design system §5 : seuil d'affichage à 400 ms).
   */
  timeout_ms: z.number().int().positive(),
  issued_at: isoDateTime,
  acked_at: isoDateTime.nullable(),
  /** Renseigné si `status` vaut `failed` ou `timeout`. */
  error: errorCode.nullable().default(null),
});
export type Command = z.infer<typeof command>;
