import { z } from 'zod';
import { isoDateTime, uuid } from '../primitives.js';
import { capabilityValue, writableCapabilityValue } from './capability.js';

/**
 * Automatisations (CDC §4).
 *
 * Une **scène** du design system (écran 1.4) est une automatisation à
 * `trigger.kind === 'manual'` — pas une seconde entité. Sans cette règle écrite,
 * quelqu'un créera une table `Scene` en double.
 */

export const sceneIcon = z.enum(['cinema', 'nuit', 'depart', 'reveil', 'alerte']);
export type SceneIcon = z.infer<typeof sceneIcon>;

/** Jours de la semaine, 1 = lundi (ISO-8601). */
export const weekday = z.number().int().min(1).max(7);

export const automationTrigger = z.discriminatedUnion('kind', [
  /** Déclenché à la demande depuis l'app — c'est le cas « scène ». */
  z.object({ kind: z.literal('manual') }),
  z.object({
    kind: z.literal('schedule'),
    /** « HH:MM » dans le fuseau du foyer (`Home.timezone`), pas en UTC. */
    at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    /** Vide = tous les jours. */
    weekdays: z.array(weekday).max(7).default([]),
  }),
  z.object({
    kind: z.literal('sensor'),
    device_id: uuid,
    /** L'automatisation part quand la capacité atteint cette valeur. */
    equals: capabilityValue,
  }),
  z.object({ kind: z.literal('presence'), event: z.enum(['first_arrives', 'last_leaves']) }),
]);
export type AutomationTrigger = z.infer<typeof automationTrigger>;

export const automationCondition = z.discriminatedUnion('kind', [
  /** « uniquement la nuit » — bornes calculées dans le fuseau du foyer. */
  z.object({ kind: z.literal('time_range'), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal('device_state'), device_id: uuid, equals: capabilityValue }),
  z.object({ kind: z.literal('someone_home'), value: z.boolean() }),
]);
export type AutomationCondition = z.infer<typeof automationCondition>;

export const automationAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set'), device_id: uuid, target: writableCapabilityValue }),
  /** Pause entre deux actions, pour les séquences (« volets puis lumières »). */
  z.object({ kind: z.literal('wait'), seconds: z.number().int().min(1).max(3600) }),
  z.object({ kind: z.literal('notify'), message: z.string().min(1).max(200) }),
]);
export type AutomationAction = z.infer<typeof automationAction>;

export const automation = z.object({
  id: uuid,
  home_id: uuid,
  name: z.string().min(1).max(60),
  icon: sceneIcon,
  trigger: automationTrigger,
  conditions: z.array(automationCondition).max(10),
  /** Exécutées dans l'ordre (écran 3.4). */
  actions: z.array(automationAction).min(1).max(50),
  enabled: z.boolean(),
  /**
   * Relecture en langage naturel, produite par le serveur (écran 3.5).
   * Générée côté backend pour rester cohérente avec l'exécution réelle et éviter
   * que l'app réimplémente la logique des déclencheurs.
   */
  summary: z.string(),
  last_run: z
    .object({ at: isoDateTime, status: z.enum(['success', 'partial', 'failed']) })
    .nullable()
    .default(null),
  created_at: isoDateTime,
});
export type Automation = z.infer<typeof automation>;

/** Journal d'exécution (écrans 1.4 et 3.6). */
export const automationRun = z.object({
  id: uuid,
  automation_id: uuid,
  /**
   * Instant théorique du déclenchement. Couplé à `automation_id`, il forme la
   * clé d'idempotence qui empêche une double exécution quand plusieurs instances
   * du backend tournent en parallèle (CDC §9).
   */
  scheduled_for: isoDateTime,
  started_at: isoDateTime,
  finished_at: isoDateTime.nullable(),
  status: z.enum(['running', 'success', 'partial', 'failed']),
  /** Appareils injoignables — alimente « 1 appareil injoignable » de l'écran 1.4. */
  failed_device_ids: z.array(uuid).default([]),
});
export type AutomationRun = z.infer<typeof automationRun>;
