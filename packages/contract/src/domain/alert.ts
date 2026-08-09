import { z } from 'zod';
import { isoDateTime, uuid } from '../primitives.js';

/**
 * Alertes et préférences de notification (CDC §4, onglet 4 du design system).
 */

export const alertCategory = z.enum([
  /** Ouverture/fermeture, mouvement détecté. */
  'security',
  /** Fuite d'eau, pile faible, appareil en défaut. */
  'safety',
  /** Appareil ou boîtier hors ligne, compte tiers à relier à nouveau. */
  'connectivity',
  /** Scénario exécuté, appareil ajouté. */
  'activity',
]);
export type AlertCategory = z.infer<typeof alertCategory>;

/**
 * Sévérité — pilote le tri du fil (écran 4.1) et la couleur de la puce.
 * Design system §15 : la couleur ne porte jamais l'information seule, le libellé
 * de catégorie l'accompagne toujours.
 */
export const alertSeverity = z.enum(['info', 'warning', 'critical']);
export type AlertSeverity = z.infer<typeof alertSeverity>;

export const alert = z.object({
  id: uuid,
  home_id: uuid,
  device_id: uuid.nullable().default(null),
  category: alertCategory,
  severity: alertSeverity,
  /** Titre court, déjà localisé par le serveur. */
  title: z.string().min(1).max(120),
  body: z.string().max(400).nullable().default(null),
  read: z.boolean(),
  created_at: isoDateTime,
});
export type Alert = z.infer<typeof alert>;

export const notificationChannel = z.enum(['push', 'email']);
export type NotificationChannel = z.infer<typeof notificationChannel>;

/**
 * Préférences de notification (écran 4.4).
 *
 * L'écran demande une activation « par catégorie **et par appareil** » : d'où
 * les deux niveaux, les exceptions par appareil l'emportant sur la catégorie.
 */
export const notificationSettings = z.object({
  home_id: uuid,
  by_category: z.record(
    alertCategory,
    z.object({
      push: z.boolean(),
      email: z.boolean(),
    }),
  ),
  /** Exceptions explicites, prioritaires sur `by_category`. */
  device_overrides: z
    .array(z.object({ device_id: uuid, muted: z.boolean() }))
    .max(500)
    .default([]),
  /** Heures pendant lesquelles seules les alertes `critical` passent en push. */
  quiet_hours: z
    .object({ from: z.string(), to: z.string() })
    .nullable()
    .default(null),
});
export type NotificationSettings = z.infer<typeof notificationSettings>;

export const pushPlatform = z.enum(['ios', 'android']);

export const pushTokenRegistration = z.object({
  platform: pushPlatform,
  token: z.string().min(10).max(512),
});
export type PushTokenRegistration = z.infer<typeof pushTokenRegistration>;
