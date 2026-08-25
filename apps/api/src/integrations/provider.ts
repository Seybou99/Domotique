import type { CapabilityValue, Protocol } from '@domotique/contract';

/**
 * Fournisseur d'écosystème tiers (CDC §6.2, §6.3).
 *
 * Distinct de `DeviceConnector`, et volontairement : un connecteur **pilote** des
 * appareils, un fournisseur **relie un compte** et énumère ce qu'il contient.
 * Tuya joue les deux rôles, Zigbee seulement le premier. Les confondre
 * obligerait le connecteur Zigbee à porter des méthodes OAuth vides.
 */

export type ProviderTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  /** Libellé lisible du compte distant, affiché à l'écran 5.3. */
  accountLabel: string;
};

export type ProviderDevice = {
  externalId: string;
  name: string;
  kind: string;
  /** Faux si aucune capacité n'est prise en charge par la plateforme. */
  supported: boolean;
  capabilities: {
    type: string;
    writable: boolean;
    min?: number;
    max?: number;
    unit?: string;
    /**
     * État au moment de la découverte, quand le fournisseur le donne.
     *
     * L'import s'en sert pour amorcer l'état chaud. Sans lui, un appareil entre
     * dans le foyer sans aucune valeur : l'interface le montre éteint, un
     * allumage semble retomber aussitôt, et rien ne se corrige tant qu'aucun
     * relevé n'arrive — ce qui n'arrive jamais si la scrutation est désactivée.
     */
    value?: CapabilityValue;
  }[];
};

/**
 * Comment un compte se relie.
 *
 *  - `oauth`   : page d'autorisation du fournisseur, dans l'application (Hue).
 *  - `console` : liaison hors application, depuis la console du fournisseur.
 *    C'est le cas de Tuya sur un projet « Cloud Development » : aucune page
 *    d'autorisation n'existe, et les appareils du compte associé s'interrogent
 *    ensuite avec les identifiants **du projet**, pas un jeton utilisateur.
 */
export type LinkMode = 'oauth' | 'console';

export interface ThirdPartyProvider {
  readonly provider: Exclude<Protocol, 'zigbee'>;
  readonly linkMode: LinkMode;

  /** URL d'autorisation à ouvrir (mode `oauth` uniquement). */
  authorizationUrl(state: string, redirectUri: string): string;

  /** Échange le code d'autorisation contre des jetons (mode `oauth`). */
  exchangeCode(code: string, redirectUri: string): Promise<ProviderTokens>;

  /** Renouvelle un jeton expiré (mode `oauth`). */
  refresh(refreshToken: string): Promise<ProviderTokens>;

  /**
   * Appareils présents sur le compte distant (écran 2.8).
   * `accessToken` est `null` en mode `console` : le fournisseur utilise alors
   * les identifiants du projet.
   */
  /**
   * @param uids Comptes techniques du SDK natif à interroger en plus du compte
   *   lié. Les appareils appairés depuis l'application leur appartiennent, et
   *   n'apparaissent pas dans la liste du projet.
   */
  listDevices(accessToken: string | null, uids?: string[]): Promise<ProviderDevice[]>;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ThirdPartyProvider>();

  register(provider: ThirdPartyProvider): void {
    this.providers.set(provider.provider, provider);
  }

  /** `null` si l'écosystème n'est pas activé sur cette instance. */
  get(provider: string): ThirdPartyProvider | null {
    return this.providers.get(provider) ?? null;
  }

  available(): string[] {
    return [...this.providers.keys()];
  }
}
