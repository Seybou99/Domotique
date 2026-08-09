import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AutomationCondition, AutomationTrigger, CapabilityValue } from '@domotique/contract';
import type { EventBus } from '../state/events.js';
import type { AutomationEngine } from './engine.js';
import { occurrencesBetween } from './schedule.js';

/**
 * Planificateur d'automatisations (CDC §9 et §11).
 *
 * Le point critique : le backend est **stateless et répliqué**. Un planificateur
 * naïf exécuterait « Bonne nuit à 23:30 » une fois par instance — trois volées de
 * commandes Zigbee, trois lignes d'historique, trois fois le quota Tuya consommé.
 *
 * La protection ne repose pas sur un verrou applicatif mais sur la contrainte
 * d'unicité `(automationId, scheduledFor)` en base : chaque instance tente
 * d'insérer l'exécution, **une seule** y parvient, les autres reçoivent une
 * violation de contrainte et passent leur tour. C'est le seul mécanisme qui
 * reste correct si une instance se fige entre le verrou et l'exécution.
 */

/** Intervalle entre deux balayages. */
const TICK_MS = 30_000;

/**
 * Rattrapage au démarrage. Après un redéploiement de deux minutes, les
 * automatisations manquées sont exécutées plutôt que silencieusement perdues.
 * Au-delà, mieux vaut ne rien faire : allumer les lumières d'un réveil à 14 h
 * serait pire que de l'avoir raté.
 */
const CATCHUP_MS = 5 * 60_000;

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastTick: Date | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly engine: AutomationEngine,
    private readonly events: EventBus,
  ) {}

  start(): () => void {
    this.lastTick = new Date(Date.now() - CATCHUP_MS);
    const timer = setInterval(() => void this.tick(), TICK_MS);
    timer.unref?.();
    this.timer = timer;
    void this.tick();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Un balayage complet, sans attendre le minuteur.
   * `after` force la borne gauche de la fenêtre — utile aux tests, qui doivent
   * pouvoir viser une échéance passée sans dépendre du rattrapage au démarrage.
   */
  async tick(now = new Date(), after?: Date): Promise<number> {
    // Les balayages ne se chevauchent pas : une exécution longue (action `wait`)
    // ne doit pas déclencher un second passage sur les mêmes échéances.
    if (this.running) return 0;
    this.running = true;
    const from = after ?? this.lastTick ?? new Date(now.getTime() - TICK_MS);

    try {
      const automations = await this.prisma.automation.findMany({
        where: { enabled: true, triggerKind: 'schedule' },
        include: { home: { select: { timezone: true } } },
      });

      let executed = 0;
      for (const automation of automations) {
        const trigger = automation.trigger as Extract<AutomationTrigger, { kind: 'schedule' }>;
        const due = occurrencesBetween(
          { at: trigger.at, weekdays: trigger.weekdays ?? [] },
          from,
          now,
          automation.home.timezone,
        );
        for (const scheduledFor of due) {
          if (await this.execute(automation, scheduledFor)) executed += 1;
        }
      }
      this.lastTick = now;
      return executed;
    } finally {
      this.running = false;
    }
  }

  /** Déclenchement par capteur (§8 du design system, écran 3.2). */
  async onDeviceState(deviceId: string, homeId: string, value: CapabilityValue): Promise<void> {
    const automations = await this.prisma.automation.findMany({
      where: { homeId, enabled: true, triggerKind: 'sensor' },
      include: { home: { select: { timezone: true } } },
    });

    for (const automation of automations) {
      const trigger = automation.trigger as Extract<AutomationTrigger, { kind: 'sensor' }>;
      if (trigger.device_id !== deviceId) continue;
      if (trigger.equals.type !== value.type) continue;
      if (JSON.stringify(trigger.equals.value) !== JSON.stringify(value.value)) continue;

      // Pas de clé d'idempotence stable ici : le déclencheur est un événement,
      // pas une échéance. On horodate à la seconde pour absorber les doublons
      // d'un même changement d'état relayé deux fois.
      const scheduledFor = new Date(Math.floor(Date.now() / 1000) * 1000);
      await this.execute(automation, scheduledFor);
    }
  }

  /**
   * Tente de réserver l'exécution puis la lance.
   * Renvoie `false` si une autre instance l'a déjà réservée.
   */
  private async execute(
    automation: {
      id: string;
      homeId: string;
      actions: unknown;
      conditions: unknown;
      home: { timezone: string };
    },
    scheduledFor: Date,
  ): Promise<boolean> {
    let run;
    try {
      run = await this.prisma.automationRun.create({
        data: { id: randomUUID(), automationId: automation.id, scheduledFor, status: 'running' },
      });
    } catch (error) {
      // P2002 = violation d'unicité : une autre instance a gagné la course.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }

    const conditions = (automation.conditions as AutomationCondition[]) ?? [];
    const met = await this.engine.conditionsMet(conditions, automation.home.timezone, scheduledFor);

    if (!met) {
      // Conditions non réunies : on conserve la trace pour que l'utilisateur
      // comprenne pourquoi « rien ne s'est passé » (écran 3.6).
      await this.finish(automation.homeId, run.id, 'success', []);
      return true;
    }

    const outcome = await this.engine.run(automation, run.id);
    await this.finish(automation.homeId, run.id, outcome.status, outcome.failedDeviceIds);
    return true;
  }

  private async finish(
    homeId: string,
    runId: string,
    status: 'success' | 'partial' | 'failed',
    failedDeviceIds: string[],
  ): Promise<void> {
    const run = await this.prisma.automationRun.update({
      where: { id: runId },
      data: { status, failedDeviceIds, finishedAt: new Date() },
    });
    await this.events.publish(homeId, {
      type: 'automation_run_updated',
      run: {
        id: run.id,
        automation_id: run.automationId,
        scheduled_for: run.scheduledFor.toISOString(),
        started_at: run.startedAt.toISOString(),
        finished_at: run.finishedAt?.toISOString() ?? null,
        status: run.status,
        failed_device_ids: run.failedDeviceIds,
      },
    });
  }
}
