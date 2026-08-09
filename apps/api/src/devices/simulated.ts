import type { CapabilityValue, Protocol, WritableCapabilityValue } from '@domotique/contract';
import type {
  DeviceConnector,
  DeviceRef,
  DiscoveredDevice,
  DiscoveredEvent,
  PairingCapable,
  StateChangeEvent,
} from './connector.js';

/**
 * Connecteur simulé — développement et tests uniquement.
 *
 * Il n'imite pas un protocole réel : il rejoue le *comportement* qui compte pour
 * le reste du système, à savoir qu'une commande est acceptée puis confirmée un
 * peu plus tard, de façon asynchrone. Cela permet de valider la boucle complète
 * (commande → événement → interface) sans matériel ni compte Tuya.
 *
 * Il est enregistré sur le protocole `zigbee` tant que le vrai connecteur MQTT
 * n'existe pas, et refuse de s'activer si `NODE_ENV === 'production'`.
 */
export class SimulatedConnector implements DeviceConnector, PairingCapable {
  readonly protocol: Protocol = 'zigbee';
  readonly ackSemantics = 'device' as const;
  readonly commandTimeoutMs = 5_000;

  private readonly listeners = new Set<(event: StateChangeEvent) => void>();
  private readonly state = new Map<string, Map<string, CapabilityValue>>();

  constructor(private readonly confirmDelayMs = 120) {}

  async discoverDevices(): Promise<DiscoveredDevice[]> {
    return [];
  }

  async sendCommand(ref: DeviceRef, target: WritableCapabilityValue): Promise<void> {
    const timer = setTimeout(() => {
      const current = this.state.get(ref.externalId) ?? new Map();
      current.set(target.type, target);
      this.state.set(ref.externalId, current);
      for (const listener of this.listeners) {
        listener({ externalId: ref.externalId, value: target, at: new Date(), deviceId: ref.deviceId });
      }
    }, this.confirmDelayMs);
    // Sans `unref`, ce minuteur retiendrait le processus au moment de l'arrêt.
    timer.unref?.();
  }

  async getState(ref: DeviceRef): Promise<CapabilityValue[]> {
    return [...(this.state.get(ref.externalId)?.values() ?? [])];
  }

  onStateChange(listener: (event: StateChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Association (permit_join simulé)

  private readonly discoveryListeners = new Set<(event: DiscoveredEvent) => void>();
  private readonly pairingTimers = new Map<string, NodeJS.Timeout>();

  async startPairing(unitId: string, _durationS: number): Promise<void> {
    // Un appareil se manifeste peu après l'ouverture de la fenêtre, comme le
    // ferait l'événement `device_joined` de Zigbee2MQTT.
    const timer = setTimeout(() => {
      for (const listener of this.discoveryListeners) {
        listener({
          unitId,
          externalId: `0x${Math.random().toString(16).slice(2, 9)}`,
          suggestedName: 'Prise Zigbee',
          kind: 'plug',
          capabilities: [{ type: 'on_off', writable: true }],
        });
      }
    }, this.confirmDelayMs * 2);
    timer.unref?.();
    this.pairingTimers.set(unitId, timer);
  }

  async stopPairing(unitId: string): Promise<void> {
    const timer = this.pairingTimers.get(unitId);
    if (timer) clearTimeout(timer);
    this.pairingTimers.delete(unitId);
  }

  onDeviceDiscovered(listener: (event: DiscoveredEvent) => void): () => void {
    this.discoveryListeners.add(listener);
    return () => this.discoveryListeners.delete(listener);
  }
}
