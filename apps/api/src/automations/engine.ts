import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  AutomationAction,
  AutomationCondition,
  CapabilityValue,
} from '@domotique/contract';
import type { DeviceService } from '../devices/service.js';
import type { EventBus } from '../state/events.js';
import type { StateStore } from '../state/store.js';
import { zonedParts } from './schedule.js';

/**
 * Exécution d'une automatisation (CDC §11, V1).
 *
 * Les actions sont exécutées **dans l'ordre** (écran 3.4) et séquentiellement :
 * « fermer les volets puis éteindre » n'a de sens que dans cet ordre, et une
 * exécution parallèle rendrait l'action `wait` absurde.
 *
 * Une action qui échoue n'interrompt pas les suivantes. Un appareil injoignable
 * ne doit pas empêcher le reste de la scène de se dérouler — l'exécution est
 * alors marquée `partial`, ce que l'écran 1.4 affiche sous la forme
 * « 1 appareil injoignable ».
 */

export type RunOutcome = {
  status: 'success' | 'partial' | 'failed';
  failedDeviceIds: string[];
};

export class AutomationEngine {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly devices: DeviceService,
    private readonly state: StateStore,
    private readonly events: EventBus,
  ) {}

  /** Évalue toutes les conditions. Vrai seulement si elles le sont toutes. */
  async conditionsMet(
    conditions: AutomationCondition[],
    timeZone: string,
    at = new Date(),
  ): Promise<boolean> {
    for (const condition of conditions) {
      if (!(await this.evaluate(condition, timeZone, at))) return false;
    }
    return true;
  }

  private async evaluate(
    condition: AutomationCondition,
    timeZone: string,
    at: Date,
  ): Promise<boolean> {
    switch (condition.kind) {
      case 'time_range': {
        const { hour, minute } = zonedParts(at, timeZone);
        const now = hour * 60 + minute;
        const from = toMinutes(condition.from);
        const to = toMinutes(condition.to);
        if (from === null || to === null) return false;
        // Une plage qui enjambe minuit (22:00 → 06:00) est inversée : on teste
        // alors l'union des deux morceaux plutôt que l'intervalle vide.
        return from <= to ? now >= from && now <= to : now >= from || now <= to;
      }

      case 'device_state': {
        const stored = await this.state.get(condition.device_id);
        const current = stored[condition.equals.type]?.value;
        return current !== undefined && sameValue(current, condition.equals);
      }

      case 'someone_home':
        // La présence n'a pas encore de source de données (pas de géolocalisation
        // ni de capteur dédié). On répond « non satisfait » plutôt que de
        // déclencher sur une information qu'on n'a pas.
        return false;
    }
  }

  async run(
    automation: { id: string; homeId: string; actions: unknown },
    runId: string,
  ): Promise<RunOutcome> {
    const actions = automation.actions as AutomationAction[];
    const failed = new Set<string>();
    let executed = 0;

    for (const action of actions) {
      try {
        switch (action.kind) {
          case 'set':
            await this.devices.sendCommand(
              action.device_id,
              // Identifiant dérivé du run et de l'appareil : rejouer une
              // exécution ne double pas les commandes.
              { command_id: derive(runId, action.device_id), target: action.target },
              { automationId: automation.id },
            );
            break;

          case 'wait':
            await new Promise((resolve) => setTimeout(resolve, action.seconds * 1000));
            break;

          case 'notify':
            await this.notify(automation.homeId, action.message);
            break;
        }
        executed += 1;
      } catch {
        if (action.kind === 'set') failed.add(action.device_id);
      }
    }

    if (failed.size === 0) return { status: 'success', failedDeviceIds: [] };
    return {
      status: executed === 0 ? 'failed' : 'partial',
      failedDeviceIds: [...failed],
    };
  }

  private async notify(homeId: string, message: string): Promise<void> {
    const alert = await this.prisma.alert.create({
      data: {
        homeId,
        category: 'activity',
        severity: 'info',
        title: message,
      },
    });
    await this.events.publish(homeId, {
      type: 'alert_created',
      alert: {
        id: alert.id,
        home_id: alert.homeId,
        device_id: null,
        category: 'activity',
        severity: 'info',
        title: alert.title,
        body: null,
        read: false,
        created_at: alert.createdAt.toISOString(),
      },
    });
  }
}

function toMinutes(text: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sameValue(a: CapabilityValue, b: CapabilityValue): boolean {
  return a.type === b.type && JSON.stringify(a.value) === JSON.stringify(b.value);
}

/**
 * Identifiant de commande déterministe pour un couple (exécution, appareil).
 * `randomUUID` ne conviendrait pas : il casserait l'idempotence du rejeu.
 */
function derive(runId: string, deviceId: string): string {
  const hex = (runId + deviceId).replace(/-/g, '');
  const bytes = hex.padEnd(32, '0').slice(0, 32);
  return [
    bytes.slice(0, 8),
    bytes.slice(8, 12),
    // Version 4 et variant conformes : la base attend un UUID valide.
    `4${bytes.slice(13, 16)}`,
    `8${bytes.slice(17, 20)}`,
    bytes.slice(20, 32),
  ].join('-');
}

export { derive as deriveCommandId, randomUUID };
