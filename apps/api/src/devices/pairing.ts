import type { PrismaClient } from '@prisma/client';
import type { PairingSession, Protocol } from '@domotique/contract';
import { AppError, notFound } from '../http/errors.js';
import type { EventBus } from '../state/events.js';
import type { PairingStore } from '../state/pairing.js';
import { supportsPairing, type ConnectorRegistry, type DiscoveredEvent } from './connector.js';

/**
 * Association des appareils Zigbee (CDC §8.3).
 *
 * Comme `DeviceService`, ce service est l'une des deux seules couches autorisées
 * à manipuler un connecteur. Une route n'en appelle jamais un directement.
 *
 * La fenêtre se referme d'elle-même : c'est une exigence de sécurité du §5.2
 * (« permit_join désactivé par défaut, activé uniquement à la demande, avec
 * expiration automatique »). Un réseau Zigbee laissé ouvert accepte n'importe
 * quel appareil à portée.
 */
export class PairingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly connectors: ConnectorRegistry,
    private readonly store: PairingStore,
    private readonly events: EventBus,
  ) {}

  /** Relaie les découvertes des connecteurs vers la session et l'app. */
  start(): () => void {
    const unsubscribers = this.connectors
      .all()
      .filter(supportsPairing)
      .map((connector) =>
        connector.onDeviceDiscovered(async (event) => {
          try {
            await this.handleDiscovery(connector.protocol, event);
          } catch (error) {
            // Même raison que dans DeviceService : hors requête HTTP, une
            // exception non capturée arrête le processus.
            console.error('[pairing] échec du traitement d’une découverte :', error);
          }
        }),
      );
    return () => unsubscribers.forEach((fn) => fn());
  }

  private async handleDiscovery(protocol: string, event: DiscoveredEvent): Promise<void> {
    const session = await this.store.get(event.unitId);
    if (!session) return; // fenêtre déjà refermée : on ignore

    // Un appareil déjà connu du foyer ne doit pas être proposé deux fois.
    const existing = await this.prisma.device.findFirst({
      where: {
        homeId: session.homeId,
        protocol: protocol as Protocol,
        externalId: event.externalId,
      },
    });

    await this.store.addDiscovered(event.unitId, {
      external_id: event.externalId,
      suggested_name: event.suggestedName,
      kind: event.kind,
      claimed: existing !== null,
    });

    await this.events.publish(session.homeId, {
      type: 'pairing_device_found',
      unit_id: event.unitId,
      external_id: event.externalId,
      suggested_name: event.suggestedName,
      kind: event.kind as 'plug',
    });
  }

  async open(unitId: string, durationS: number): Promise<PairingSession> {
    const unit = await this.prisma.deviceUnit.findUnique({ where: { id: unitId } });
    if (!unit || !unit.homeId) throw notFound('Boîtier introuvable');
    if (!unit.online) throw new AppError('unit_offline', 'Boîtier hors ligne');

    const connector = this.connectors.get('zigbee');
    if (!connector || !supportsPairing(connector)) {
      throw new AppError('internal_error', 'Aucun connecteur Zigbee actif');
    }

    const expiresAt = new Date(Date.now() + durationS * 1000);
    await this.store.open(
      { unitId, homeId: unit.homeId, expiresAt: expiresAt.toISOString(), discovered: [] },
      // Une seconde de marge : le store doit survivre juste après l'expiration
      // annoncée, le temps que l'app lise l'état final de la session.
      durationS + 1,
    );
    await connector.startPairing(unitId, durationS);

    // Fermeture automatique, indépendante de toute action de l'app.
    const timer = setTimeout(() => void this.close(unitId), durationS * 1000);
    timer.unref?.();

    return { device_unit_id: unitId, expires_at: expiresAt.toISOString(), discovered: [] };
  }

  async status(unitId: string): Promise<PairingSession | null> {
    const session = await this.store.get(unitId);
    if (!session) return null;
    return {
      device_unit_id: session.unitId,
      expires_at: session.expiresAt,
      discovered: session.discovered.map((d) => ({
        external_id: d.external_id,
        suggested_name: d.suggested_name,
        kind: d.kind as 'plug',
        claimed: d.claimed,
      })),
    };
  }

  async close(unitId: string): Promise<void> {
    const session = await this.store.get(unitId);
    const connector = this.connectors.get('zigbee');
    if (connector && supportsPairing(connector)) await connector.stopPairing(unitId);
    await this.store.close(unitId);
    if (session) {
      await this.events.publish(session.homeId, { type: 'pairing_closed', unit_id: unitId });
    }
  }
}
