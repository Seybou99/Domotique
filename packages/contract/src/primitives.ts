import { z } from 'zod';

/**
 * Briques de base du contrat.
 *
 * Règle du paquet : rien ici ni ailleurs ne doit exposer un champ propre à un
 * écosystème tiers (Data Point Tuya, ressource Hue, topic MQTT…). Le contrat
 * décrit le modèle unifié du CDC §6 — c'est ce qui rend le principe « client
 * léger » vérifiable par le compilateur et non simplement documentaire.
 */

/** Version du contrat. Toute route est préfixée : une app ancienne reste servie. */
export const API_VERSION = 'v1' as const;
export const API_PREFIX = `/${API_VERSION}` as const;

export const uuid = z.string().uuid();

/** Horodatage ISO 8601 en UTC. Jamais de timestamp numérique dans le contrat. */
export const isoDateTime = z.string().datetime({ offset: true });

/** Identifiant d'événement du flux temps réel — ordonnable lexicographiquement. */
export const eventId = z.string().min(1).max(64);

export const email = z.string().email().max(254);

/** Fuseau IANA du foyer (« Europe/Paris »), requis par le planificateur (CDC §11). */
export const timezone = z.string().min(3).max(64);

/**
 * Pagination.
 *
 * `limit` est **coercé** : une chaîne de requête ne transporte que des chaînes,
 * et `?limit=50` arriverait sinon comme `"50"` et serait rejeté. Tout champ
 * numérique d'un schéma `query` doit suivre cette règle.
 */
export const pagination = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type Pagination = z.infer<typeof pagination>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    /** Absent = fin de liste. */
    next_cursor: z.string().max(256).nullable().default(null),
  });
}

/**
 * Codes d'erreur applicatifs.
 *
 * L'app s'appuie dessus pour choisir un message — jamais sur le texte de
 * `message`, qui est destiné aux journaux. Le design system §14 impose une
 * formulation factuelle avec une action possible : c'est le code qui permet de
 * choisir laquelle.
 */
export const errorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  /** Le boîtier de cet appareil est hors ligne. */
  'unit_offline',
  /** La commande n'a pas été confirmée dans le délai imparti. */
  'command_timeout',
  /** L'appareil a refusé la commande. */
  'device_rejected',
  /** Quota du connecteur tiers atteint — la commande a été mise en file (CDC §6.5). */
  'connector_quota_exceeded',
  /** Le compte tiers doit être relié à nouveau (refresh token expiré ou révoqué). */
  'third_party_reauth_required',
  /** Compte Tuya enregistré dans une autre région que le projet cloud (CDC §6.2). */
  'third_party_region_mismatch',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const apiError = z.object({
  error: z.object({
    code: errorCode,
    /** Message technique, destiné aux journaux — pas à l'affichage tel quel. */
    message: z.string(),
    /** Erreurs de validation par champ, si applicable. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Présent sur `rate_limited` et `connector_quota_exceeded`. */
    retry_after_s: z.number().int().nonnegative().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;

export const ok = z.object({ ok: z.literal(true) });
