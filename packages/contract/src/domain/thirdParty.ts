import { z } from 'zod';
import { isoDateTime, uuid } from '../primitives.js';
import { deviceKind, protocol } from './device.js';

/**
 * Comptes tiers (CDC §4, écran 5.3).
 *
 * **Aucun champ de token ici, et c'est délibéré.** `access_token`,
 * `refresh_token` et `expires_at` existent en base mais ne franchissent jamais
 * cette frontière (CDC §7). Comme le backend valide ses réponses avec ce même
 * schéma, une fuite accidentelle est arrêtée à la sérialisation plutôt qu'en
 * relecture de code.
 */
export const thirdPartyAccount = z.object({
  id: uuid,
  /** Rattaché au foyer, pas à l'utilisateur : un compte lié survit au départ de celui qui l'a lié. */
  home_id: uuid,
  provider: protocol.exclude(['zigbee']),
  /** Libellé du compte distant, tel qu'affiché à l'utilisateur (souvent son e-mail). */
  account_label: z.string().max(120),
  linked_by_user_id: uuid,
  linked_at: isoDateTime,
  /** `true` quand le refresh a échoué : l'app doit proposer de relier à nouveau. */
  reauth_required: z.boolean(),
  device_count: z.number().int().nonnegative(),
});
export type ThirdPartyAccount = z.infer<typeof thirdPartyAccount>;

/** Appareil trouvé sur un compte tiers, avant import (écran 2.8). */
export const discoveredDevice = z.object({
  external_id: z.string().min(1).max(128),
  name: z.string(),
  kind: deviceKind,
  /** Déjà importé dans ce foyer ? */
  imported: z.boolean(),
  /** Faux si aucune de ses capacités n'est prise en charge par la plateforme. */
  supported: z.boolean(),
});
export type DiscoveredDevice = z.infer<typeof discoveredDevice>;
