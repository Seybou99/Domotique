import { z } from 'zod';
import { eventId, isoDateTime, uuid } from '../primitives.js';
import { capabilityValue, changeOrigin } from '../domain/capability.js';
import { command } from '../domain/command.js';
import { alert } from '../domain/alert.js';
import { automationRun } from '../domain/automation.js';
import { deviceKind } from '../domain/device.js';

/**
 * Canal temps réel `/v1/realtime` (CDC §5).
 *
 * Un canal par foyer. Chaque événement porte un `event_id` croissant : c'est lui
 * qui permet le rejeu après coupure. Le transport doit donc conserver une
 * fenêtre d'événements (Redis Stream avec MAXLEN, et non Pub/Sub, qui ne garde
 * rien) — sinon `last_event_id` ne peut rien rejouer.
 */

// ───────────────────────────────────────────────────── Messages app → serveur

export const clientMessage = z.discriminatedUnion('type', [
  /**
   * Abonnement à un foyer. `last_event_id` demande le rejeu du delta ; si la
   * fenêtre est dépassée, le serveur répond `resync_required`.
   */
  z.object({
    type: z.literal('subscribe'),
    home_id: uuid,
    last_event_id: eventId.nullable().default(null),
  }),
  z.object({ type: z.literal('unsubscribe'), home_id: uuid }),
  /** Réponse à `auth_expiring` — évite de couper la socket à chaque rotation. */
  z.object({ type: z.literal('auth_refresh'), access_token: z.string() }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ───────────────────────────────────────────────────── Messages serveur → app

/** Événements métier, tous encapsulés dans `serverEvent` ci-dessous. */
export const eventPayload = z.discriminatedUnion('type', [
  /** Une capacité a changé de valeur, avec son origine (écran 2.2). */
  z.object({
    type: z.literal('device_state_changed'),
    device_id: uuid,
    capability: capabilityValue,
    origin: changeOrigin,
  }),
  z.object({
    type: z.literal('device_availability_changed'),
    device_id: uuid,
    online: z.boolean(),
  }),
  z.object({ type: z.literal('device_added'), device_id: uuid, name: z.string(), kind: deviceKind }),
  z.object({ type: z.literal('device_removed'), device_id: uuid }),

  /**
   * Transition d'une commande. C'est ce message qui fait sortir le `Toggle` de
   * son état « en cours » côté app, ou le repasse à l'état réel en cas d'échec.
   */
  z.object({ type: z.literal('command_updated'), command }),

  z.object({ type: z.literal('unit_availability_changed'), unit_id: uuid, online: z.boolean() }),
  /** Appareil Zigbee détecté pendant une fenêtre d'association (écran 2.5). */
  z.object({
    type: z.literal('pairing_device_found'),
    unit_id: uuid,
    external_id: z.string(),
    suggested_name: z.string(),
    kind: deviceKind,
  }),
  z.object({ type: z.literal('pairing_closed'), unit_id: uuid }),

  z.object({ type: z.literal('automation_run_updated'), run: automationRun }),
  z.object({ type: z.literal('alert_created'), alert }),

  /** Le compte tiers doit être relié à nouveau (refresh échoué). */
  z.object({ type: z.literal('integration_reauth_required'), account_id: uuid, provider: z.string() }),
]);
export type EventPayload = z.infer<typeof eventPayload>;
export type EventType = EventPayload['type'];

/** Enveloppe de tout événement métier. */
export const serverEvent = z.object({
  kind: z.literal('event'),
  event_id: eventId,
  home_id: uuid,
  at: isoDateTime,
  data: eventPayload,
});
export type ServerEvent = z.infer<typeof serverEvent>;

export const resyncReason = z.enum(['window_expired', 'server_restart', 'permissions_changed']);
export type ResyncReason = z.infer<typeof resyncReason>;

/** Messages de contrôle de la session — hors flux métier, donc sans `event_id`. */
export const serverControl = z.discriminatedUnion('type', [
  /** Abonnement confirmé ; `event_id` est le point de reprise du flux. */
  z.object({ kind: z.literal('control'), type: z.literal('subscribed'), home_id: uuid, event_id: eventId }),
  /**
   * Le delta demandé n'est plus disponible : l'app doit appeler
   * `GET /v1/homes/:id/state` puis se réabonner avec l'`event_id` renvoyé.
   */
  z.object({
    kind: z.literal('control'),
    type: z.literal('resync_required'),
    home_id: uuid,
    reason: resyncReason,
  }),
  /** L'access token expire bientôt : envoyer `auth_refresh` avant la coupure. */
  z.object({
    kind: z.literal('control'),
    type: z.literal('auth_expiring'),
    expires_in_s: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal('control'), type: z.literal('pong') }),
]);
export type ServerControl = z.infer<typeof serverControl>;

export const serverMessage = z.union([serverEvent, serverControl]);
export type ServerMessage = z.infer<typeof serverMessage>;

/**
 * Codes de fermeture applicatifs (plage privée 4000-4999).
 * `auth_expired` est le cas normal après un `auth_expiring` resté sans réponse :
 * l'app renouvelle via `/v1/auth/refresh` et se reconnecte.
 */
export const WS_CLOSE = {
  auth_expired: 4001,
  auth_invalid: 4002,
  forbidden: 4003,
  /** Trop de messages entrants — l'app doit temporiser avant de reconnecter. */
  rate_limited: 4029,
} as const;

export const WS_PATH = '/v1/realtime' as const;
