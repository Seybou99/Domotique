import { signRequest } from './signature.js';
import { AppError } from '../../http/errors.js';

/**
 * Client HTTP Tuya Cloud.
 *
 * Deux responsabilités seulement : signer, et traduire les codes d'erreur Tuya
 * en codes du contrat. Aucune logique métier — elle appartient au connecteur.
 */

export type TuyaConfig = {
  accessId: string;
  accessSecret: string;
  /** Endpoint régional. Doit correspondre à la région du projet cloud. */
  dataCenter: string;
};

type TuyaResponse<T> = {
  success: boolean;
  result?: T;
  code?: number;
  msg?: string;
  t?: number;
};

/**
 * Correspondance des codes d'erreur Tuya vers le contrat.
 *
 * 1106 (permission denied) sur une requête pourtant signée signale presque
 * toujours un compte enregistré dans une autre région que le projet — le cas
 * que le CDC §6.2 demande d'expliciter plutôt que de renvoyer une erreur
 * générique.
 */
function toAppError(code: number | undefined, msg: string | undefined): AppError {
  switch (code) {
    case 1010:
    case 1011:
    case 1004:
      return new AppError('third_party_reauth_required', `Jeton Tuya invalide (${code}) : ${msg}`);
    case 1106:
      return new AppError(
        'third_party_region_mismatch',
        'Compte Tuya enregistré dans une autre région que le projet cloud',
      );
    case 1100:
    case 2007:
      return new AppError('connector_quota_exceeded', `Quota Tuya atteint (${code}) : ${msg}`);
    case 28841002:
    case 28841105:
      /**
       * L'abonnement au service est expiré ou jamais activé. Piège du projet
       * neuf : l'onglet « API de service » affiche le service comme autorisé
       * alors que son abonnement, lui, n'est pas actif — ce sont deux choses
       * distinctes dans la console Tuya.
       */
      return new AppError(
        'third_party_reauth_required',
        `Abonnement au service Tuya inactif (${code}) : ${msg}. ` +
          'Console Tuya → Cloud → Cloud Services → IoT Core → activer l’essai.',
      );
    case 1108:
      return new AppError(
        'internal_error',
        `Chemin d’API Tuya invalide (${msg}) — cet endpoint n’existe pas sur ce projet.`,
      );
    case 1109:
      return new AppError('device_rejected', `Requête refusée par Tuya : ${msg}`);
    case 1114:
      /**
       * Le message de Tuya parle d'adresse IP, mais la cause la plus fréquente
       * est un **mauvais endpoint régional** : le projet n'existe pas sur ce
       * centre de données. Vérifié en conditions réelles — le même projet
       * renvoyait 1114 sur `openapi.tuyaeu.com` et un jeton valide sur
       * `openapi-weaz.tuyaeu.com`, alors que la console affiche « Western
       * Europe » dans les deux cas. `npm run tuya:check` teste tous les centres.
       */
      return new AppError(
        'third_party_region_mismatch',
        `Projet Tuya introuvable sur ce centre de données (${msg}). ` +
          'Vérifier TUYA_DATA_CENTER — lancer `npm run tuya:check`.',
      );
    default:
      return new AppError('internal_error', `Erreur Tuya ${code ?? '?'} : ${msg ?? 'inconnue'}`);
  }
}

export class TuyaClient {
  private token: { value: string; refresh: string; expiresAt: number } | null = null;

  constructor(private readonly config: TuyaConfig) {}

  /**
   * Jeton d'accès du projet (grant_type=1).
   *
   * Renouvelé 60 s avant l'échéance : un jeton qui expire pendant le vol d'une
   * requête produit une erreur difficile à relier à sa cause.
   */
  private async projectToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;

    const result = await this.request<{ access_token: string; refresh_token: string; expire_time: number }>(
      'GET',
      '/v1.0/token?grant_type=1',
      undefined,
      null,
    );
    this.token = {
      value: result.access_token,
      refresh: result.refresh_token,
      expiresAt: Date.now() + result.expire_time * 1000,
    };
    return this.token.value;
  }

  /**
   * `accessToken` : `undefined` = jeton projet (obtenu à la demande),
   * `null` = requête d'obtention de jeton, `string` = jeton d'un compte lié.
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    accessToken?: string | null,
  ): Promise<T> {
    const serialized = body === undefined ? '' : JSON.stringify(body);
    const token =
      accessToken === null ? undefined : (accessToken ?? (await this.projectToken()));

    const { headers } = signRequest({
      clientId: this.config.accessId,
      clientSecret: this.config.accessSecret,
      method,
      path,
      body: serialized,
      accessToken: token,
    });

    const response = await fetch(this.config.dataCenter.replace(/\/$/, '') + path, {
      method,
      headers,
      body: serialized === '' ? undefined : serialized,
    });

    if (!response.ok) {
      throw new AppError('internal_error', `Tuya HTTP ${response.status}`);
    }

    const payload = (await response.json()) as TuyaResponse<T>;
    if (!payload.success || payload.result === undefined) {
      throw toAppError(payload.code, payload.msg);
    }
    return payload.result;
  }

  /** Sonde de configuration : vérifie que les identifiants et la région sont bons. */
  async checkCredentials(): Promise<{ ok: true; expiresInS: number }> {
    const result = await this.request<{ access_token: string; expire_time: number }>(
      'GET',
      '/v1.0/token?grant_type=1',
      undefined,
      null,
    );
    return { ok: true, expiresInS: result.expire_time };
  }
}
