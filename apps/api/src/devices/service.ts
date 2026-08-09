import type { PrismaClient } from '@prisma/client';
import type {
  CapabilityState,
  CapabilityValue,
  ChangeOrigin,
  Command,
  CommandRequest,
  Device,
  Protocol,
  WritableCapabilityValue,
} from '@domotique/contract';
import { capabilityValue } from '@domotique/contract';
import { AppError, conflict, notFound } from '../http/errors.js';
import type { EventBus } from '../state/events.js';
import type { StateStore } from '../state/store.js';
import type { ConnectorRegistry, DeviceRef } from './connector.js';

/**
 * DeviceService (CDC §6).
 *
 * **Seul** point d'entrée des connecteurs. Aucune route n'appelle un connecteur
 * directement : c'est la règle qui garde l'abstraction vivante quand Hue et Tapo
 * arriveront.
 */
export class DeviceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly connectors: ConnectorRegistry,
    private readonly state: StateStore,
    private readonly events: EventBus,
  ) {}

  /**
   * Branché après coup par la composition : le planificateur dépend déjà du
   * moteur, qui dépend du DeviceService. Un rappel optionnel évite le cycle.
   */
  private onState: ((deviceId: string, homeId: string, value: CapabilityValue) => void) | null = null;

  setStateListener(listener: (deviceId: string, homeId: string, value: CapabilityValue) => void) {
    this.onState = listener;
  }

  /** Branche les flux des connecteurs sur le state store et le bus d'événements. */
  start(): () => void {
    const unsubscribers = this.connectors.all().map((connector) =>
      connector.onStateChange(async (event) => {
        /**
         * Ce gestionnaire tourne hors de toute requête HTTP : une exception s'y
         * transforme en rejet non capturé, ce qui arrête le processus Node par
         * défaut. Un appareil supprimé pendant qu'une confirmation est en vol,
         * ou une coupure passagère de la base, suffirait à faire tomber le
         * serveur entier.
         */
        try {
          const device = await this.resolveDevice(connector.protocol, event);
          if (!device) return;
          const origin = await this.resolveOrigin(device.id, event.value);
          await this.recordState(device.id, device.homeId, event.value, event.at, origin);
        } catch (error) {
          console.error(
            `[devices] échec du traitement d'un état ${connector.protocol}/${event.externalId} :`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );
    return () => unsubscribers.forEach((fn) => fn());
  }

  /**
   * Identifie l'appareil visé par un événement de connecteur.
   *
   * Retrouver l'appareil par `(protocole, externalId)` seul n'est pas fiable :
   * plusieurs foyers peuvent porter le même identifiant externe, et la mise à
   * jour partirait alors sur l'appareil d'un autre client. On restreint donc au
   * contexte fourni par le connecteur, et on refuse d'agir plutôt que de deviner
   * quand l'ambiguïté persiste.
   */
  private async resolveDevice(
    protocol: string,
    event: { externalId: string; deviceId?: string; unitId?: string; accountId?: string },
  ) {
    if (event.deviceId) {
      return this.prisma.device.findUnique({ where: { id: event.deviceId } });
    }

    const matches = await this.prisma.device.findMany({
      where: {
        protocol: protocol as Protocol,
        externalId: event.externalId,
        ...(event.unitId ? { unitId: event.unitId } : {}),
        ...(event.accountId ? { accountId: event.accountId } : {}),
      },
      take: 2,
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Silencieusement choisir le premier reviendrait à écrire l'état d'un
      // client dans le foyer d'un autre.
      console.warn(
        `[devices] événement ${protocol}/${event.externalId} ambigu : ${matches.length} appareils correspondent, ignoré`,
      );
    }
    return null;
  }

  /**
   * Corrèle un changement d'état entrant avec une commande en attente.
   *
   * Sans cela, un appareil qui confirme une commande apparaîtrait comme s'étant
   * allumé tout seul : l'écran 2.2 afficherait « allumé » au lieu de
   * « allumé · app », et la commande resterait indéfiniment en `sent`.
   *
   * La corrélation est **optimiste** — on rapproche par appareil, capacité et
   * valeur, dans la fenêtre de temporisation de la commande. C'est le seul
   * rapprochement possible pour les connecteurs en `ackSemantics: 'gateway'`
   * (Tuya), dont les notifications de statut ne portent aucun identifiant de
   * commande.
   */
  private async resolveOrigin(
    deviceId: string,
    value: CapabilityValue,
  ): Promise<{ kind: 'user' | 'automation' | 'device'; id?: string }> {
    const pending = await this.prisma.command.findFirst({
      where: { deviceId, status: { in: ['pending', 'sent'] } },
      orderBy: { issuedAt: 'desc' },
    });
    if (!pending) return { kind: 'device' };

    const target = pending.payload as CapabilityValue;
    const sameCapability = target?.type === value.type;
    const sameValue = JSON.stringify(target?.value) === JSON.stringify(value.value);
    const inWindow = Date.now() - pending.issuedAt.getTime() <= pending.timeoutMs;
    if (!sameCapability || !sameValue || !inWindow) return { kind: 'device' };

    const acked = await this.prisma.command.update({
      where: { id: pending.id },
      data: { status: 'acked', ackedAt: new Date() },
    });
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { homeId: true },
    });
    if (device) {
      await this.events.publish(device.homeId, { type: 'command_updated', command: toCommand(acked) });
    }

    if (pending.issuedByUserId) return { kind: 'user', id: pending.issuedByUserId };
    if (pending.issuedByAutomationId) return { kind: 'automation', id: pending.issuedByAutomationId };
    return { kind: 'device' };
  }

  /** Complète l'origine avec le libellé attendu par le contrat. */
  private async describeOrigin(origin: {
    kind: 'user' | 'automation' | 'device' | 'external';
    id?: string;
  }): Promise<ChangeOrigin> {
    if (origin.kind === 'user' && origin.id) {
      const user = await this.prisma.user.findUnique({
        where: { id: origin.id },
        select: { displayName: true },
      });
      return { kind: 'user', user_id: origin.id, display_name: user?.displayName ?? 'Membre retiré' };
    }
    if (origin.kind === 'automation' && origin.id) {
      const automation = await this.prisma.automation.findUnique({
        where: { id: origin.id },
        select: { name: true },
      });
      return { kind: 'automation', automation_id: origin.id, name: automation?.name ?? 'Scénario supprimé' };
    }
    if (origin.kind === 'external') return { kind: 'external', provider: 'inconnu' };
    return { kind: 'device' };
  }

  /**
   * Enregistre une valeur : state store d'abord (source de vérité chaude),
   * historique ensuite, diffusion enfin.
   */
  async recordState(
    deviceId: string,
    homeId: string,
    value: CapabilityValue,
    at = new Date(),
    origin: { kind: 'user' | 'automation' | 'device' | 'external'; id?: string } = { kind: 'device' },
  ): Promise<void> {
    await this.state.set(deviceId, value, at);
    await this.prisma.stateChange.create({
      data: {
        deviceId,
        type: value.type,
        value: value as object,
        originKind: origin.kind,
        originId: origin.id ?? null,
        at,
      },
    });
    await this.events.publish(homeId, {
      type: 'device_state_changed',
      device_id: deviceId,
      capability: value,
      origin: await this.describeOrigin(origin),
    });
    // Déclencheurs par capteur (écran 3.2). Hors du chemin critique : une
    // automatisation qui échoue ne doit pas empêcher l'enregistrement de l'état.
    this.onState?.(deviceId, homeId, value);
  }

  /**
   * Envoi d'une commande, idempotent sur `command_id`.
   *
   * Rejouer la même requête après une perte réseau renvoie la commande existante
   * au lieu d'en créer une seconde — c'est ce qui rend le rejeu sûr côté app.
   */
  async sendCommand(
    deviceId: string,
    request: CommandRequest,
    issuedBy: { userId?: string; automationId?: string },
  ): Promise<Command> {
    const existing = await this.prisma.command.findUnique({ where: { id: request.command_id } });
    if (existing) {
      if (existing.deviceId !== deviceId) {
        throw conflict('Cet identifiant de commande vise déjà un autre appareil');
      }
      return toCommand(existing);
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { capabilities: true },
    });
    if (!device) throw notFound('Appareil introuvable');

    const capability = device.capabilities.find((c) => c.type === request.target.type);
    if (!capability) {
      throw new AppError('validation_failed', `Capacité ${request.target.type} absente de cet appareil`);
    }
    if (!capability.writable) {
      throw new AppError('validation_failed', `La capacité ${request.target.type} est en lecture seule`);
    }
    if (!device.online) throw new AppError('unit_offline', 'Appareil hors ligne');

    const connector = this.connectors.get(device.protocol as Protocol);
    if (!connector) {
      throw new AppError('internal_error', `Aucun connecteur actif pour ${device.protocol}`);
    }

    const created = await this.prisma.command.create({
      data: {
        id: request.command_id,
        deviceId,
        payload: request.target as object,
        status: 'pending',
        ackSemantics: connector.ackSemantics,
        timeoutMs: connector.commandTimeoutMs,
        issuedByUserId: issuedBy.userId ?? null,
        issuedByAutomationId: issuedBy.automationId ?? null,
      },
    });

    const ref: DeviceRef = {
      deviceId: device.id,
      externalId: device.externalId,
      unitId: device.unitId,
      accountId: device.accountId,
    };

    try {
      await connector.sendCommand(ref, request.target as WritableCapabilityValue);
    } catch (error) {
      const failed = await this.prisma.command.update({
        where: { id: created.id },
        data: { status: 'failed', errorCode: 'device_rejected' },
      });
      await this.events.publish(device.homeId, { type: 'command_updated', command: toCommand(failed) });
      throw error instanceof AppError ? error : new AppError('device_rejected', 'Commande refusée');
    }

    const sent = await this.prisma.command.update({
      where: { id: created.id },
      data: { status: 'sent' },
    });
    const command = toCommand(sent);
    await this.events.publish(device.homeId, { type: 'command_updated', command });
    return command;
  }

  /** Assemble un `Device` du contrat : structure en base, valeurs dans le store. */
  async toContractDevice(
    row: DeviceRow,
    values?: Record<string, { value: CapabilityValue; updated_at: string }>,
  ): Promise<Device> {
    const stored = values ?? (await this.state.get(row.id));
    const capabilities: CapabilityState[] = row.capabilities.map((c) => {
      const hot = stored[c.type];
      const fallback = c.snapshotValue ? safeValue(c.snapshotValue) : null;
      return {
        type: c.type as CapabilityState['type'],
        schema: {
          type: c.type as CapabilityState['type'],
          writable: c.writable,
          min: c.min,
          max: c.max,
          step: c.step,
          unit: c.unit as CapabilityState['schema']['unit'],
        },
        value: hot?.value ?? fallback,
        updated_at: hot?.updated_at ?? c.snapshotUpdatedAt?.toISOString() ?? null,
      };
    });

    return {
      id: row.id,
      home_id: row.homeId,
      room_id: row.roomId,
      name: row.name,
      kind: row.kind as Device['kind'],
      source: {
        protocol: row.protocol as Protocol,
        external_id: row.externalId,
        third_party_account_id: row.accountId,
        device_unit_id: row.unitId,
      },
      online: row.online,
      last_seen: row.lastSeen?.toISOString() ?? null,
      capabilities,
    };
  }
}

type DeviceRow = {
  id: string;
  homeId: string;
  roomId: string | null;
  name: string;
  kind: string;
  protocol: string;
  externalId: string;
  accountId: string | null;
  unitId: string | null;
  online: boolean;
  lastSeen: Date | null;
  capabilities: {
    type: string;
    writable: boolean;
    min: number | null;
    max: number | null;
    step: number | null;
    unit: string;
    snapshotValue: unknown;
    snapshotUpdatedAt: Date | null;
  }[];
};

/** Un instantané écrit par une version antérieure peut ne plus être conforme. */
function safeValue(raw: unknown): CapabilityValue | null {
  const parsed = capabilityValue.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toCommand(row: {
  id: string;
  deviceId: string;
  payload: unknown;
  status: string;
  ackSemantics: string;
  timeoutMs: number;
  errorCode: string | null;
  issuedAt: Date;
  ackedAt: Date | null;
}): Command {
  return {
    command_id: row.id,
    device_id: row.deviceId,
    target: row.payload as Command['target'],
    status: row.status as Command['status'],
    ack_semantics: row.ackSemantics as Command['ack_semantics'],
    timeout_ms: row.timeoutMs,
    issued_at: row.issuedAt.toISOString(),
    acked_at: row.ackedAt?.toISOString() ?? null,
    error: row.errorCode as Command['error'],
  };
}
