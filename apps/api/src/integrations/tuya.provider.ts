import type { Protocol } from '@domotique/contract';
import { TuyaClient } from '../devices/tuya/client.js';
import { dpToCapability, type DpSpec } from '../devices/tuya/mapping.js';
import { AppError } from '../http/errors.js';
import type { ProviderDevice, ProviderTokens, ThirdPartyProvider } from './provider.js';

/**
 * Fournisseur Tuya (CDC §6.2).
 *
 * Note d'état : l'authentification du projet est validée (la signature est
 * acceptée par les serveurs Tuya), mais les appels restent refusés tant que
 * l'IP sortante n'est pas autorisée sur le projet cloud — voir
 * `npm run tuya:check`. Le code ci-dessous est donc écrit mais non éprouvé
 * contre un compte réel : à revérifier avant mise en service.
 */
export class TuyaProvider implements ThirdPartyProvider {
  readonly provider = 'tuya' as const satisfies Exclude<Protocol, 'zigbee'>;
  /**
   * Vérifié en conditions réelles sur un projet « Cloud Development » :
   * `/v1.0/auth/authorize` répond `1108 uri path invalid`, et `/v1.0/users`
   * répond « could not find the oem saas info ». Il n'existe donc aucun flux
   * d'autorisation utilisateur — la liaison passe par la console Tuya.
   */
  readonly linkMode = 'console' as const;

  constructor(
    private readonly client: TuyaClient,
    private readonly accessId: string,
    /** Doit être le même endpoint que celui du client — voir le piège dans env.ts. */
    private readonly dataCenter: string,
  ) {}

  /**
   * Tuya n'expose **pas** de page d'autorisation OAuth sur un projet
   * « Cloud Development » standard : `/v1.0/auth/authorize` répond
   * `1108 uri path invalid`. Vérifié en conditions réelles.
   *
   * La liaison d'un compte Smart Life se fait depuis la console Tuya
   * (Devices → Link App Account → QR code scanné depuis l'app Smart Life).
   * Le backend interroge ensuite les appareils du compte associé avec le jeton
   * **du projet**, pas un jeton utilisateur.
   *
   * On échoue donc explicitement plutôt que d'ouvrir une page morte dans le
   * navigateur de l'utilisateur.
   */
  authorizationUrl(): string {
    throw new AppError(
      'validation_failed',
      'Tuya ne permet pas la liaison de compte depuis l’application : elle se fait ' +
        'depuis la console Tuya (Devices → Link App Account), puis les appareils ' +
        'apparaissent automatiquement.',
    );
  }

  async exchangeCode(code: string): Promise<ProviderTokens> {
    const result = await this.client.request<{
      access_token: string;
      refresh_token: string;
      expire_time: number;
      uid: string;
    }>('GET', `/v1.0/token?grant_type=2&code=${encodeURIComponent(code)}`, undefined, null);

    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: new Date(Date.now() + result.expire_time * 1000),
      accountLabel: result.uid,
    };
  }

  async refresh(refreshToken: string): Promise<ProviderTokens> {
    const result = await this.client.request<{
      access_token: string;
      refresh_token: string;
      expire_time: number;
      uid: string;
    }>('GET', `/v1.0/token/${encodeURIComponent(refreshToken)}`, undefined, null);

    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: new Date(Date.now() + result.expire_time * 1000),
      accountLabel: result.uid,
    };
  }

  /**
   * Échelles et bornes déclarées par l'appareil lui-même.
   *
   * Sans elles, le mapping retombe sur des valeurs typiques — et un modèle qui
   * s'en écarte donne un relevé faux sans que rien ne le signale : une
   * consommation dix fois trop grande reste plausible. La fiche de l'appareil
   * est la seule source qui ne se trompe pas.
   *
   * Un échec est sans gravité : les défauts prennent le relais, et un appareil
   * dont la fiche est illisible vaut mieux qu'un import qui échoue en entier.
   */
  private async specifications(deviceId: string): Promise<Record<string, DpSpec>> {
    try {
      const spec = await this.client.request<{
        functions?: { code: string; values: string }[];
        status?: { code: string; values: string }[];
      }>('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}/specifications`);

      const parsed: Record<string, DpSpec> = {};
      for (const entry of [...(spec.functions ?? []), ...(spec.status ?? [])]) {
        try {
          const values = JSON.parse(entry.values) as Partial<DpSpec>;
          // Les Data Points booléens ou énumérés n'ont pas de bornes : les
          // retenir écraserait les défauts avec des valeurs vides.
          if (typeof values.min === 'number' && typeof values.max === 'number') {
            parsed[entry.code] = values as DpSpec;
          }
        } catch {
          continue;
        }
      }
      return parsed;
    } catch {
      return {};
    }
  }

  /**
   * Appareils rattachés au projet.
   *
   * `accessToken` est ignoré : en mode console, il n'y a pas de jeton
   * utilisateur. On interroge avec les identifiants du projet, ce que fait le
   * client quand on ne lui passe rien.
   *
   * **Deux origines, deux routes.** Les appareils appairés depuis un compte
   * Smart Life existant arrivent par `associated-users`. Ceux appairés par
   * l'application elle-même appartiennent au compte technique du SDK, et
   * `associated-users` ne les voit pas — il faut les demander compte par compte.
   * Vérifié en conditions réelles : une prise visible dans la console, en ligne
   * et liée au projet, restait introuvable par la première route.
   */

  async listDevices(_accessToken: string | null, uids: string[] = []): Promise<ProviderDevice[]> {
    const collected = new Map<string, RawTuyaDevice>();

    const { devices } = await this.client.request<{ devices: RawTuyaDevice[] }>(
      'GET',
      '/v1.0/iot-01/associated-users/devices?size=100',
    );
    for (const device of devices) collected.set(device.id, device);

    for (const uid of uids) {
      // L'échec d'un compte ne doit pas priver des appareils des autres : un uid
      // périmé est une anomalie locale, pas une panne du connecteur.
      try {
        const owned = await this.client.request<RawTuyaDevice[]>(
          'GET',
          `/v1.0/users/${encodeURIComponent(uid)}/devices`,
        );
        for (const device of owned ?? []) collected.set(device.id, device);
      } catch {
        continue;
      }
    }

    const list = [...collected.values()];
    const specs = await Promise.all(list.map((device) => this.specifications(device.id)));

    return list.map((device, index) => {
      // Une capacité n'est retenue que si le mapping sait la traduire : mieux
      // vaut importer un appareil partiellement pilotable que d'exposer des
      // Data Points bruts que l'application ne saurait pas afficher.
      const capabilities = (device.status ?? [])
        .map((dp) => dpToCapability(dp.code, dp.value, specs[index]))
        .filter((value): value is NonNullable<typeof value> => value !== null)
        // La valeur est conservée, pas seulement le type : elle amorce l'état
        // chaud à l'import, sans quoi l'appareil arrive sans état connu.
        .map((value) => ({ type: value.type, writable: isWritable(value.type), value }));

      return {
        externalId: device.id,
        name: device.name,
        kind: toKind(device.category),
        supported: capabilities.length > 0,
        capabilities,
      };
    });
  }
}

/** Appareil tel que le renvoient les deux routes de listing. */
type RawTuyaDevice = {
  id: string;
  name: string;
  category: string;
  status: { code: string; value: unknown }[];
};

const WRITABLE = new Set(['on_off', 'brightness', 'color_temp', 'color_hs', 'position', 'target_temperature']);
const isWritable = (type: string) => WRITABLE.has(type);

/** Catégorie Tuya → type d'appareil du contrat (pilote le choix d'icône). */
function toKind(category: string): string {
  switch (category) {
    case 'dj':
    case 'dd':
    case 'dc':
      return 'light';
    case 'cz':
    case 'pc':
      return 'plug';
    case 'mcs':
      return 'contact';
    case 'sj':
      return 'leak';
    case 'wk':
      return 'thermostat';
    case 'cl':
      return 'cover';
    case 'fs':
      return 'fan';
    case 'ms':
      return 'lock';
    default:
      return 'plug';
  }
}

export function createTuyaProvider(env: {
  TUYA_ACCESS_ID: string;
  TUYA_ACCESS_SECRET: string;
  TUYA_DATA_CENTER: string;
}): TuyaProvider | null {
  if (!env.TUYA_ACCESS_ID || !env.TUYA_ACCESS_SECRET) return null;
  const client = new TuyaClient({
    accessId: env.TUYA_ACCESS_ID,
    accessSecret: env.TUYA_ACCESS_SECRET,
    dataCenter: env.TUYA_DATA_CENTER,
  });
  return new TuyaProvider(client, env.TUYA_ACCESS_ID, env.TUYA_DATA_CENTER);
}

export { AppError };
