import { z } from 'zod';
import { defineEndpoint } from './define.js';
import { email, isoDateTime, ok, paginated, pagination, timezone, uuid } from '../primitives.js';
import { home, homeMember, homeRole, room, roomIcon, user } from '../domain/home.js';
import { device, deviceKind, deviceUnit, pairingSession } from '../domain/device.js';
import { capabilityValue, stateChange } from '../domain/capability.js';
import { command, commandRequest } from '../domain/command.js';
import { automation, automationAction, automationCondition, automationRun, automationTrigger, sceneIcon } from '../domain/automation.js';
import { alert, alertCategory, notificationSettings, pushTokenRegistration } from '../domain/alert.js';
import { discoveredDevice, thirdPartyAccount } from '../domain/thirdParty.js';
import { protocol } from '../domain/device.js';

/**
 * Contrat REST v1 (CDC §5).
 *
 * Toutes les routes sont préfixées `/v1` par `buildPath`. Une app installée
 * continuera d'être servie quand `/v2` apparaîtra — un client mobile ne se met
 * pas à jour de force.
 */

// ─────────────────────────────────────────────────────────────── Authentification

const tokens = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  /** Durée de vie de l'access token, en secondes. */
  expires_in: z.number().int().positive(),
});

export const auth = {
  signup: defineEndpoint({
    method: 'POST',
    path: '/auth/signup',
    summary: 'Création de compte',
    auth: 'none',
    body: z.object({
      email,
      password: z.string().min(10).max(200),
      display_name: z.string().min(1).max(80),
    }),
    response: z.object({ user, tokens }),
  }),
  login: defineEndpoint({
    method: 'POST',
    path: '/auth/login',
    summary: 'Connexion',
    auth: 'none',
    body: z.object({ email, password: z.string().min(1).max(200) }),
    response: z.object({ user, tokens }),
  }),
  refresh: defineEndpoint({
    method: 'POST',
    path: '/auth/refresh',
    summary: 'Renouvellement des jetons',
    auth: 'none',
    body: z.object({ refresh_token: z.string() }),
    response: z.object({ tokens }),
  }),
  logout: defineEndpoint({
    method: 'POST',
    path: '/auth/logout',
    summary: 'Révocation du refresh token courant',
    body: z.object({ refresh_token: z.string() }),
    response: ok,
  }),
  me: defineEndpoint({
    method: 'GET',
    path: '/auth/me',
    summary: 'Profil de l’utilisateur courant',
    response: z.object({ user }),
  }),
} as const;

// ─────────────────────────────────────────────────────────────────────── Foyers

export const homes = {
  list: defineEndpoint({
    method: 'GET',
    path: '/homes',
    summary: 'Foyers auxquels appartient l’utilisateur',
    response: z.object({ items: z.array(home) }),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/homes',
    summary: 'Création d’un foyer (onboarding écran 3)',
    body: z.object({
      name: z.string().min(1).max(60),
      address: z.string().max(200).optional(),
      timezone,
    }),
    response: z.object({ home }),
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/homes/:home_id',
    summary: 'Renommage, adresse, fuseau',
    params: z.object({ home_id: uuid }),
    body: z.object({
      name: z.string().min(1).max(60).optional(),
      address: z.string().max(200).nullable().optional(),
      timezone: timezone.optional(),
    }),
    response: z.object({ home }),
  }),
  /**
   * Instantané complet de l'état du foyer.
   *
   * Sert de repli au temps réel : quand l'`event_id` demandé à la reconnexion est
   * sorti de la fenêtre de rejeu, l'app repart d'ici (CDC §5). L'`event_id`
   * renvoyé permet de reprendre le flux exactement où l'instantané s'arrête.
   */
  state: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/state',
    summary: 'Instantané complet — resynchronisation après coupure',
    params: z.object({ home_id: uuid }),
    response: z.object({
      home,
      rooms: z.array(room),
      devices: z.array(device),
      units: z.array(deviceUnit),
      event_id: z.string(),
    }),
  }),
  members: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/members',
    summary: 'Membres du foyer et leurs rôles (écran 5.2)',
    params: z.object({ home_id: uuid }),
    response: z.object({ items: z.array(homeMember) }),
  }),
  invite: defineEndpoint({
    method: 'POST',
    path: '/homes/:home_id/members',
    summary: 'Invitation d’un membre',
    params: z.object({ home_id: uuid }),
    body: z.object({ email, role: homeRole.exclude(['owner']) }),
    response: z.object({ member: homeMember }),
  }),
  removeMember: defineEndpoint({
    method: 'DELETE',
    path: '/homes/:home_id/members/:user_id',
    summary: 'Retrait d’un membre',
    params: z.object({ home_id: uuid, user_id: uuid }),
    response: ok,
  }),
} as const;

// ─────────────────────────────────────────────────────────────────────── Pièces

export const rooms = {
  list: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/rooms',
    summary: 'Pièces du foyer (écran 1.1)',
    params: z.object({ home_id: uuid }),
    response: z.object({ items: z.array(room) }),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/homes/:home_id/rooms',
    summary: 'Création d’une pièce (écran 1.5)',
    params: z.object({ home_id: uuid }),
    body: z.object({
      name: z.string().min(1).max(40),
      icon: roomIcon,
      device_ids: z.array(uuid).max(200).default([]),
    }),
    response: z.object({ room }),
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/rooms/:room_id',
    summary: 'Renommage ou changement d’icône',
    params: z.object({ room_id: uuid }),
    body: z.object({ name: z.string().min(1).max(40).optional(), icon: roomIcon.optional() }),
    response: z.object({ room }),
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/rooms/:room_id',
    summary: 'Suppression — les appareils rattachés deviennent sans pièce',
    params: z.object({ room_id: uuid }),
    response: ok,
  }),
  /** Réorganisation du tableau de bord (écran 1.6) — un seul appel, pas N. */
  reorder: defineEndpoint({
    method: 'PUT',
    path: '/homes/:home_id/rooms/order',
    summary: 'Ordre d’affichage des pièces',
    params: z.object({ home_id: uuid }),
    body: z.object({ room_ids: z.array(uuid).max(100) }),
    response: z.object({ items: z.array(room) }),
  }),
} as const;

// ────────────────────────────────────────────────────────────────────── Boîtiers

export const units = {
  list: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/units',
    summary: 'Boîtiers du foyer et leur statut (écran 2.9)',
    params: z.object({ home_id: uuid }),
    response: z.object({ items: z.array(deviceUnit) }),
  }),
  /**
   * Association d'un boîtier à un foyer par QR code (CDC §8).
   * Le `claim_code` est à usage unique et à durée limitée : il n'est pas un
   * mécanisme d'authentification permanent — celui-ci est le certificat mTLS.
   */
  claim: defineEndpoint({
    method: 'POST',
    path: '/devices/claim',
    summary: 'Association d’un boîtier par QR code (onboarding écran 6)',
    body: z.object({
      serial: z.string().min(6).max(64),
      claim_code: z.string().min(6).max(64),
      home_id: uuid,
      name: z.string().min(1).max(60).optional(),
    }),
    response: z.object({ unit: deviceUnit }),
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/units/:unit_id',
    summary: 'Retrait d’un boîtier (écran 5.4)',
    params: z.object({ unit_id: uuid }),
    body: z.object({
      /** Que faire des appareils Zigbee qui en dépendent. */
      devices: z.enum(['delete', 'keep_orphaned']).default('delete'),
    }),
    response: ok,
  }),
  /** Ouverture de la fenêtre d'association Zigbee (écran 2.5). */
  startPairing: defineEndpoint({
    method: 'POST',
    path: '/units/:unit_id/pairing',
    summary: 'Activation du permit_join, avec expiration automatique',
    params: z.object({ unit_id: uuid }),
    body: z.object({ duration_s: z.number().int().min(30).max(180).default(60) }),
    response: z.object({ session: pairingSession }),
  }),
  stopPairing: defineEndpoint({
    method: 'DELETE',
    path: '/units/:unit_id/pairing',
    summary: 'Fermeture anticipée du mode association',
    params: z.object({ unit_id: uuid }),
    response: ok,
  }),
} as const;

// ────────────────────────────────────────────────────────────────────── Appareils

export const devices = {
  list: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/devices',
    summary: 'Liste complète, filtrable (écran 2.1)',
    params: z.object({ home_id: uuid }),
    query: z.object({
      room_id: uuid.optional(),
      kind: deviceKind.optional(),
      protocol: protocol.optional(),
      /** Recherche sur le nom. */
      q: z.string().max(60).optional(),
    }),
    response: z.object({ items: z.array(device) }),
  }),
  get: defineEndpoint({
    method: 'GET',
    path: '/devices/:device_id',
    summary: 'Détail d’un appareil (écran 2.2)',
    params: z.object({ device_id: uuid }),
    response: z.object({ device }),
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/devices/:device_id',
    summary: 'Renommage, changement de pièce ou d’icône (écran 2.3)',
    params: z.object({ device_id: uuid }),
    body: z.object({
      name: z.string().min(1).max(60).optional(),
      room_id: uuid.nullable().optional(),
      kind: deviceKind.optional(),
    }),
    response: z.object({ device }),
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/devices/:device_id',
    summary: 'Suppression de l’appareil du foyer',
    params: z.object({ device_id: uuid }),
    response: ok,
  }),
  /**
   * Envoi d'une commande.
   *
   * Idempotent sur `command_id` : rejouer la même requête après une perte réseau
   * renvoie la commande existante au lieu d'en créer une seconde.
   */
  sendCommand: defineEndpoint({
    method: 'POST',
    path: '/devices/:device_id/command',
    summary: 'Pilotage — idempotent sur command_id',
    params: z.object({ device_id: uuid }),
    body: commandRequest,
    response: z.object({ command }),
  }),
  getCommand: defineEndpoint({
    method: 'GET',
    path: '/devices/:device_id/commands/:command_id',
    summary: 'Suivi d’une commande (repli si le WebSocket est coupé)',
    params: z.object({ device_id: uuid, command_id: uuid }),
    response: z.object({ command }),
  }),
  /** Historique d'état avec l'origine de chaque changement (écran 2.2). */
  history: defineEndpoint({
    method: 'GET',
    path: '/devices/:device_id/history',
    summary: 'Historique d’état, origine comprise',
    params: z.object({ device_id: uuid }),
    query: pagination.extend({ since: isoDateTime.optional() }),
    response: paginated(stateChange),
  }),
  /** Série de consommation pour le graphique de l'écran 2.2. */
  energy: defineEndpoint({
    method: 'GET',
    path: '/devices/:device_id/energy',
    summary: 'Consommation agrégée',
    params: z.object({ device_id: uuid }),
    query: z.object({
      bucket: z.enum(['hour', 'day']).default('hour'),
      from: isoDateTime,
      to: isoDateTime,
    }),
    response: z.object({
      unit: z.literal('kWh'),
      points: z.array(z.object({ at: isoDateTime, value: z.number().nonnegative() })),
    }),
  }),
} as const;

// ────────────────────────────────────────────────────────────────── Comptes tiers

export const integrations = {
  list: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/integrations',
    summary: 'Comptes tiers reliés (écran 5.3)',
    params: z.object({ home_id: uuid }),
    response: z.object({ items: z.array(thirdPartyAccount) }),
  }),
  /**
   * URL d'autorisation OAuth à ouvrir dans la WebView (écran 2.7).
   * L'app ne connaît ni le client_id ni le secret : elle ouvre l'URL, c'est tout.
   */
  oauthUrl: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/integrations/:provider/oauth-url',
    summary: 'URL d’autorisation du fournisseur',
    params: z.object({ home_id: uuid, provider: protocol.exclude(['zigbee']) }),
    response: z.object({
      url: z.string().url(),
      /** À renvoyer au callback — protège du CSRF. */
      state: z.string(),
      /** URL dont l'apparition dans la WebView signale la fin du flux. */
      redirect_uri: z.string().url(),
    }),
  }),
  /**
   * Liaison d'un écosystème dont le compte se relie **hors application**.
   *
   * Tuya en est le cas type : sur un projet « Cloud Development », il n'existe
   * pas de page d'autorisation OAuth (`/v1.0/auth/authorize` répond
   * `uri path invalid`, et le projet n'a pas d'app OEM). Le compte se relie une
   * fois depuis la console du fournisseur, puis la plateforme interroge ses
   * appareils avec les identifiants du projet.
   *
   * Distinct de `oauthUrl` / `oauthCallback`, qui restent le chemin des
   * écosystèmes offrant un vrai OAuth (Hue).
   */
  link: defineEndpoint({
    method: 'POST',
    path: '/homes/:home_id/integrations/:provider/link',
    summary: 'Déclare un écosystème relié hors application (console du fournisseur)',
    params: z.object({ home_id: uuid, provider: protocol.exclude(['zigbee']) }),
    body: z.object({ label: z.string().min(1).max(120).optional() }),
    response: z.object({ account: thirdPartyAccount }),
  }),

  oauthCallback: defineEndpoint({
    method: 'POST',
    path: '/homes/:home_id/integrations/:provider/callback',
    summary: 'Échange du code d’autorisation',
    params: z.object({ home_id: uuid, provider: protocol.exclude(['zigbee']) }),
    body: z.object({ code: z.string().min(1), state: z.string().min(1) }),
    response: z.object({ account: thirdPartyAccount }),
  }),
  discover: defineEndpoint({
    method: 'GET',
    path: '/integrations/:account_id/discover',
    summary: 'Appareils trouvés sur le compte, avant import (écran 2.8)',
    params: z.object({ account_id: uuid }),
    response: z.object({ items: z.array(discoveredDevice) }),
  }),
  importDevices: defineEndpoint({
    method: 'POST',
    path: '/integrations/:account_id/import',
    summary: 'Import de la sélection dans le foyer',
    params: z.object({ account_id: uuid }),
    body: z.object({ external_ids: z.array(z.string()).min(1).max(200) }),
    response: z.object({ devices: z.array(device) }),
  }),
  unlink: defineEndpoint({
    method: 'DELETE',
    path: '/integrations/:account_id',
    summary: 'Déconnexion du compte tiers',
    params: z.object({ account_id: uuid }),
    body: z.object({ devices: z.enum(['delete', 'keep_orphaned']).default('delete') }),
    response: ok,
  }),
} as const;

// ───────────────────────────────────────────────────────────────────── Scénarios

const automationPayload = z.object({
  name: z.string().min(1).max(60),
  icon: sceneIcon,
  trigger: automationTrigger,
  conditions: z.array(automationCondition).max(10).default([]),
  actions: z.array(automationAction).min(1).max(50),
  enabled: z.boolean().default(true),
});

export const automations = {
  list: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/automations',
    summary: 'Scénarios et scènes du foyer (écrans 1.1 et 3.1)',
    params: z.object({ home_id: uuid }),
    response: z.object({ items: z.array(automation) }),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/homes/:home_id/automations',
    summary: 'Création (écrans 3.2 à 3.5)',
    params: z.object({ home_id: uuid }),
    body: automationPayload,
    response: z.object({ automation }),
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/automations/:automation_id',
    summary: 'Modification ou activation/désactivation',
    params: z.object({ automation_id: uuid }),
    body: automationPayload.partial(),
    response: z.object({ automation }),
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/automations/:automation_id',
    summary: 'Suppression',
    params: z.object({ automation_id: uuid }),
    response: ok,
  }),
  /**
   * Exécution immédiate — distincte de `update({enabled})`, qui n'active que le
   * déclencheur. Confondre les deux est l'erreur classique de cet écran.
   */
  run: defineEndpoint({
    method: 'POST',
    path: '/automations/:automation_id/run',
    summary: 'Lancer maintenant (bouton « Lancer » de l’écran 3.1)',
    params: z.object({ automation_id: uuid }),
    body: z.object({ run_id: uuid }),
    response: z.object({ run: automationRun }),
  }),
  history: defineEndpoint({
    method: 'GET',
    path: '/automations/:automation_id/history',
    summary: 'Journal d’exécution (écrans 1.4 et 3.6)',
    params: z.object({ automation_id: uuid }),
    query: pagination,
    response: paginated(automationRun),
  }),
} as const;

// ─────────────────────────────────────────────────────────────────────── Alertes

export const alerts = {
  list: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/alerts',
    summary: 'Fil chronologique (écran 4.1)',
    params: z.object({ home_id: uuid }),
    query: pagination.extend({
      category: alertCategory.optional(),
      unread_only: z.boolean().default(false),
    }),
    response: paginated(alert).and(z.object({ unread_count: z.number().int().nonnegative() })),
  }),
  markRead: defineEndpoint({
    method: 'PATCH',
    path: '/alerts/:alert_id/read',
    summary: 'Marquer comme lue',
    params: z.object({ alert_id: uuid }),
    response: ok,
  }),
  markAllRead: defineEndpoint({
    method: 'POST',
    path: '/homes/:home_id/alerts/read-all',
    summary: 'Tout marquer comme lu',
    params: z.object({ home_id: uuid }),
    response: ok,
  }),
  getSettings: defineEndpoint({
    method: 'GET',
    path: '/homes/:home_id/notifications/settings',
    summary: 'Préférences de notification (écran 4.4)',
    params: z.object({ home_id: uuid }),
    response: z.object({ settings: notificationSettings }),
  }),
  updateSettings: defineEndpoint({
    method: 'PATCH',
    path: '/homes/:home_id/notifications/settings',
    summary: 'Mise à jour des préférences',
    params: z.object({ home_id: uuid }),
    body: notificationSettings.omit({ home_id: true }).partial(),
    response: z.object({ settings: notificationSettings }),
  }),
  registerPushToken: defineEndpoint({
    method: 'POST',
    path: '/notifications/push-tokens',
    summary: 'Enregistrement du jeton push de cet appareil mobile',
    body: pushTokenRegistration,
    response: ok,
  }),
  unregisterPushToken: defineEndpoint({
    method: 'DELETE',
    path: '/notifications/push-tokens',
    summary: 'Retrait du jeton (déconnexion)',
    body: z.object({ token: z.string() }),
    response: ok,
  }),
} as const;

/** Registre complet — sert aux tests de cohérence et à la génération de doc. */
export const api = { auth, homes, rooms, units, devices, integrations, automations, alerts } as const;

export type Api = typeof api;

/** Types utilitaires réexportés pour l'usage applicatif. */
export type { Endpoint } from './define.js';
export { capabilityValue };
