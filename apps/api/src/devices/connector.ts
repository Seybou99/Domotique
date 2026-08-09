import type {
  AckSemantics,
  CapabilityValue,
  Protocol,
  WritableCapabilityValue,
} from '@domotique/contract';

/**
 * Interface commune des intégrations (CDC §6).
 *
 * Ajouter un écosystème = ajouter une implémentation. Ni l'API exposée à l'app,
 * ni le modèle `Device`, ni un contrôleur ne doivent changer. C'est cette
 * promesse qui justifie toute la couche d'abstraction.
 *
 * Deux propriétés déclaratives portent les différences irréductibles entre
 * protocoles, plutôt que de les laisser implicites :
 *
 *  - `ackSemantics` : `device` quand l'appareil confirme lui-même (Zigbee via le
 *    boîtier), `gateway` quand seul le cloud du fabricant accuse réception
 *    (Tuya), `none` quand rien ne revient. Sans cette distinction, `acked` ne
 *    voudrait pas dire la même chose selon la marque de l'ampoule.
 *  - `commandTimeoutMs` : un aller-retour Zigbee local et un appel au cloud Tuya
 *    n'ont pas le même ordre de grandeur.
 */

export type DeviceRef = {
  deviceId: string;
  externalId: string;
  /** `null` pour les protocoles cloud. */
  unitId: string | null;
  /** `null` pour Zigbee. */
  accountId: string | null;
};

export type DiscoveredDevice = {
  externalId: string;
  name: string;
  kind: string;
  capabilities: { type: string; writable: boolean; min?: number; max?: number; unit?: string }[];
};

/**
 * Changement d'état poussé par une source.
 *
 * `externalId` seul ne suffit pas à identifier l'appareil : deux foyers peuvent
 * porter le même identifiant externe (appareil remplacé, boîtier réattribué,
 * base de test). Le connecteur doit donc fournir le contexte dont il dispose —
 * `deviceId` s'il le connaît, sinon le boîtier ou le compte tiers d'où provient
 * l'événement.
 */
export type StateChangeEvent = {
  externalId: string;
  value: CapabilityValue;
  at: Date;
  deviceId?: string;
  unitId?: string;
  accountId?: string;
};

export interface DeviceConnector {
  readonly protocol: Protocol;
  readonly ackSemantics: AckSemantics;
  readonly commandTimeoutMs: number;

  /** Appareils disponibles sur la source (compte tiers ou boîtier). */
  discoverDevices(scope: { accountId?: string; unitId?: string }): Promise<DiscoveredDevice[]>;

  /**
   * Envoie une commande. Doit convertir la valeur normalisée du contrat vers
   * l'échelle native (Tuya 0-1000, Zigbee 0-254) — jamais l'inverse.
   * Résout quand la commande est *partie*, pas quand elle est confirmée.
   */
  sendCommand(ref: DeviceRef, target: WritableCapabilityValue): Promise<void>;

  /** Lecture directe — sert à la resynchronisation après perte du state store. */
  getState(ref: DeviceRef): Promise<CapabilityValue[]>;

  /** Flux de changements d'état poussés par la source. */
  onStateChange(listener: (event: StateChangeEvent) => void): () => void;
}

/**
 * Découverte d'un appareil pendant une fenêtre d'association (§8.3).
 */
export type DiscoveredEvent = {
  unitId: string;
  externalId: string;
  suggestedName: string;
  kind: string;
  capabilities: DiscoveredDevice['capabilities'];
};

/**
 * Extension pour les protocoles à association explicite.
 *
 * Seul le Zigbee en a besoin : ouvrir temporairement le réseau (`permit_join`)
 * n'a pas d'équivalent côté cloud tiers, où les appareils sont déjà appairés
 * chez le fabricant et se contentent d'être importés. L'extension est donc
 * optionnelle plutôt qu'imposée à tous les connecteurs par l'interface de base.
 */
export interface PairingCapable {
  startPairing(unitId: string, durationS: number): Promise<void>;
  stopPairing(unitId: string): Promise<void>;
  onDeviceDiscovered(listener: (event: DiscoveredEvent) => void): () => void;
}

export function supportsPairing(
  connector: DeviceConnector,
): connector is DeviceConnector & PairingCapable {
  return typeof (connector as Partial<PairingCapable>).startPairing === 'function';
}

export class ConnectorRegistry {
  private readonly connectors = new Map<Protocol, DeviceConnector>();

  register(connector: DeviceConnector): void {
    this.connectors.set(connector.protocol, connector);
  }

  /** `null` si le protocole n'est pas activé (connecteur non configuré). */
  get(protocol: Protocol): DeviceConnector | null {
    return this.connectors.get(protocol) ?? null;
  }

  all(): DeviceConnector[] {
    return [...this.connectors.values()];
  }
}
