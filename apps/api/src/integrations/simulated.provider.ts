import { randomUUID } from 'node:crypto';
import type { ProviderDevice, ProviderTokens, ThirdPartyProvider } from './provider.js';

/**
 * Fournisseur simulé — développement uniquement.
 *
 * Enregistré sous `hue`, dont le connecteur réel est prévu en V2 et n'existe
 * pas encore. Il n'usurpe donc l'identité d'aucun écosystème actif : le flux
 * OAuth complet (URL d'autorisation → échange de code → énumération → import)
 * est testable de bout en bout sans dépendre d'un tiers, et sans jamais faire
 * passer un faux compte pour un vrai compte Tuya.
 */
export class SimulatedProvider implements ThirdPartyProvider {
  readonly provider = 'hue' as const;
  readonly linkMode = 'oauth' as const;

  authorizationUrl(state: string, redirectUri: string): string {
    // Redirige immédiatement vers le callback avec un code factice : l'app peut
    // dérouler le parcours de la WebView sans intervention humaine.
    const url = new URL(redirectUri);
    url.searchParams.set('code', `simule-${state.slice(0, 8)}`);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    if (!code.startsWith('simule-')) {
      throw new Error('Code d’autorisation invalide');
    }
    return {
      accessToken: `acc-${randomUUID()}`,
      refreshToken: `ref-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 3600_000),
      accountLabel: 'compte.demo@example.com',
    };
  }

  async refresh(): Promise<ProviderTokens> {
    return {
      accessToken: `acc-${randomUUID()}`,
      refreshToken: `ref-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 3600_000),
      accountLabel: 'compte.demo@example.com',
    };
  }

  async listDevices(): Promise<ProviderDevice[]> {
    return [
      {
        externalId: 'sim-lampe-1',
        name: 'Lampe canapé',
        kind: 'lamp',
        supported: true,
        capabilities: [
          { type: 'on_off', writable: true },
          { type: 'brightness', writable: true, min: 1, max: 100, unit: '%' },
        ],
      },
      {
        externalId: 'sim-prise-1',
        name: 'Prise TV',
        kind: 'plug',
        supported: true,
        capabilities: [
          { type: 'on_off', writable: true },
          { type: 'power', writable: false, unit: 'W' },
        ],
      },
      {
        // Cas réel à ne pas oublier : un appareil dont aucune capacité n'est
        // prise en charge doit apparaître, grisé, plutôt que disparaître sans
        // explication de la liste d'import.
        externalId: 'sim-exotique-1',
        name: 'Diffuseur de parfum',
        kind: 'plug',
        supported: false,
        capabilities: [],
      },
    ];
  }
}
