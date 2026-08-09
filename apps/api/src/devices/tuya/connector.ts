import type {
  CapabilityValue,
  Protocol,
  WritableCapabilityValue,
} from '@domotique/contract';
import { AppError } from '../../http/errors.js';
import type {
  DeviceConnector,
  DeviceRef,
  DiscoveredDevice,
  StateChangeEvent,
} from '../connector.js';
import { capabilityToDp, dpToCapability, type DpSpec } from './mapping.js';
import type { CallBudget } from '../../integrations/budget.js';

/**
 * Connecteur Tuya (CDC §6.2).
 *
 * Pilote les appareils Wi-Fi d'un compte tiers relié. Distinct du *fournisseur*
 * (`TuyaProvider`), qui relie le compte et énumère ses appareils : ici on
 * commande et on écoute.
 *
 * `ackSemantics: 'gateway'` — Tuya accuse réception de la **requête**, pas de
 * l'exécution. Un `HTTP 200` signifie « le cloud a pris la commande », jamais
 * « la prise s'est allumée ». La confirmation réelle arrive plus tard, par un
 * changement d'état sans identifiant de commande : c'est la corrélation
 * optimiste de `DeviceService` qui les rapproche.
 */

/** Sous-ensemble de `TuyaClient` dont le connecteur a besoin — facilite les tests. */
export interface TuyaTransport {
  request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    accessToken?: string | null,
  ): Promise<T>;
}

type SpecificationResponse = {
  category: string;
  functions: { code: string; type: string; values: string }[];
  status: { code: string; type: string; values: string }[];
};

type StatusResponse = { code: string; value: unknown }[];

/**
 * Suivi de l'état.
 *
 * **Solution transitoire, et désactivée par défaut.** Le CDC §6.2 demande de
 * s'abonner au service de notification de statut plutôt que de sonder l'API —
 * un flux Pulsar qui demande un client dédié. En attendant, la scrutation existe
 * mais reste éteinte : chaque lecture consomme le pack de ressources du projet,
 * dont l'essai gratuit plafonne à 0,20 USD par mois. Une scrutation à 30 s
 * représente 2 880 appels par jour et par appareil.
 *
 * `onStateChange` est conçu pour que le remplacement par Pulsar ne change rien
 * au reste du système : même événement, même contrat.
 */

export class TuyaConnector implements DeviceConnector {
  readonly protocol: Protocol = 'tuya';
  readonly ackSemantics = 'gateway' as const;
  /** Un aller-retour vers le cloud du fabricant, pas un réseau local. */
  readonly commandTimeoutMs = 10_000;

  private readonly listeners = new Set<(event: StateChangeEvent) => void>();
  /** Bornes réelles par appareil — évitent de deviner les échelles. */
  private readonly specs = new Map<string, Record<string, DpSpec>>();
  /** Dernière valeur vue, pour n'émettre que les vrais changements. */
  private readonly lastSeen = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly transport: TuyaTransport,
    /** Résout le jeton d'accès d'un compte lié — voir `ThirdPartyAccounts`. */
    private readonly accessToken: (accountId: string) => Promise<string | null>,
    /** Appareils Tuya à suivre, fournis par la couche qui connaît la base. */
    private readonly trackedDevices: () => Promise<DeviceRef[]>,
    private readonly options: {
      /** 0 = pas de scrutation. */
      pollIntervalMs?: number;
      budget?: CallBudget;
    } = {},
  ) {}

  // ─────────────────────────────────────────────────────────────── Commandes

  async sendCommand(ref: DeviceRef, target: WritableCapabilityValue): Promise<void> {
    if (!ref.accountId) {
      throw new AppError('internal_error', 'Appareil Tuya sans compte tiers rattaché');
    }
    await this.options.budget?.require(ref.accountId);
    const token = await this.accessToken(ref.accountId);
    const specs = await this.specificationsFor(ref, token);

    const dp = capabilityToDp(target, specs);
    if (!dp) {
      throw new AppError('validation_failed', `Capacité ${target.type} non pilotable en Tuya`);
    }

    // `undefined` = identifiants du projet ; `null` signifierait « requête
    // d'obtention de jeton », ce qui n'est pas le cas ici.
    await this.transport.request(
      'POST',
      `/v1.0/iot-03/devices/${encodeURIComponent(ref.externalId)}/commands`,
      { commands: [{ code: dp.code, value: dp.value }] },
      token ?? undefined,
    );
  }

  async getState(ref: DeviceRef): Promise<CapabilityValue[]> {
    if (!ref.accountId) return [];
    const token = await this.accessToken(ref.accountId);
    const specs = await this.specificationsFor(ref, token);

    const status = await this.transport.request<StatusResponse>(
      'GET',
      `/v1.0/iot-03/devices/${encodeURIComponent(ref.externalId)}/status`,
      undefined,
      token ?? undefined,
    );

    return status
      .map((dp) => dpToCapability(dp.code, dp.value, specs))
      .filter((value): value is CapabilityValue => value !== null);
  }

  async discoverDevices(scope: { accountId?: string }): Promise<DiscoveredDevice[]> {
    // L'énumération d'un compte appartient au fournisseur : le connecteur ne
    // sait pas ce qu'un compte contient, il sait piloter ce qu'on lui désigne.
    void scope;
    return [];
  }

  // ──────────────────────────────────────────────────────────── Changements

  onStateChange(listener: (event: StateChangeEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.startPolling();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopPolling();
    };
  }

  private startPolling(): void {
    const interval = this.options.pollIntervalMs ?? 0;
    if (this.timer || interval <= 0) return;
    const timer = setInterval(() => void this.poll(), interval);
    timer.unref?.();
    this.timer = timer;
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exposé pour les tests et pour un rafraîchissement à la demande. */
  async poll(): Promise<void> {
    let devices: DeviceRef[];
    try {
      devices = await this.trackedDevices();
    } catch {
      return; // base indisponible : on retentera au prochain tour
    }

    for (const ref of devices) {
      try {
        // En scrutation, un budget épuisé fait sauter le tour au lieu de lever :
        // ce n'est pas une action utilisateur, personne n'attend de réponse.
        if (ref.accountId && this.options.budget) {
          const wait = await this.options.budget.reserve(ref.accountId);
          if (wait !== null) continue;
        }
        const values = await this.getState(ref);
        for (const value of values) {
          const key = `${ref.deviceId}:${value.type}`;
          const encoded = JSON.stringify(value.value);
          // N'émettre que les vraies transitions : sinon chaque tour de
          // scrutation réécrirait l'historique et republierait des événements.
          if (this.lastSeen.get(key) === encoded) continue;
          this.lastSeen.set(key, encoded);

          for (const listener of this.listeners) {
            listener({
              externalId: ref.externalId,
              deviceId: ref.deviceId,
              accountId: ref.accountId ?? undefined,
              value,
              at: new Date(),
            });
          }
        }
      } catch (error) {
        // Un appareil injoignable ne doit pas interrompre le suivi des autres.
        console.warn(
          `[tuya] lecture impossible pour ${ref.externalId} :`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  // ───────────────────────────────────────────────────────── Spécifications

  /**
   * Bornes réelles de l'appareil.
   *
   * Sans elles, on devinerait qu'une luminosité va de 10 à 1000 — vrai pour
   * `bright_value_v2`, faux pour les modèles anciens en 25-255, et faux pour
   * certains fabricants qui choisissent leur propre plage. Le résultat serait
   * une lampe à mi-course affichée à 4 %.
   *
   * Mis en cache : les bornes d'un appareil ne changent pas, et chaque appel
   * consomme du quota.
   */
  private async specificationsFor(
    ref: DeviceRef,
    token: string | null,
  ): Promise<Record<string, DpSpec>> {
    const cached = this.specs.get(ref.externalId);
    if (cached) return cached;

    try {
      const response = await this.transport.request<SpecificationResponse>(
        'GET',
        `/v1.0/devices/${encodeURIComponent(ref.externalId)}/specifications`,
        undefined,
        token ?? undefined,
      );
      const specs = parseSpecifications(response);
      this.specs.set(ref.externalId, specs);
      return specs;
    } catch {
      // Spécifications indisponibles : le mapping retombe sur ses valeurs par
      // défaut. Mieux vaut une échelle approximative qu'un appareil inutilisable.
      this.specs.set(ref.externalId, {});
      return {};
    }
  }
}

/**
 * Tuya décrit ses bornes dans une chaîne JSON, par Data Point :
 * `{"min":10,"max":1000,"scale":0,"step":1}`.
 */
export function parseSpecifications(response: SpecificationResponse): Record<string, DpSpec> {
  const out: Record<string, DpSpec> = {};
  for (const entry of [...(response.functions ?? []), ...(response.status ?? [])]) {
    if (entry.type !== 'Integer') continue;
    try {
      const parsed = JSON.parse(entry.values) as Partial<DpSpec>;
      if (typeof parsed.min === 'number' && typeof parsed.max === 'number') {
        out[entry.code] = {
          min: parsed.min,
          max: parsed.max,
          ...(typeof parsed.scale === 'number' ? { scale: parsed.scale } : {}),
          ...(typeof parsed.step === 'number' ? { step: parsed.step } : {}),
        };
      }
    } catch {
      // Description illisible : on ignore ce Data Point plutôt que de tout perdre.
    }
  }
  return out;
}
