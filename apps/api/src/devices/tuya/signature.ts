import { createHash, createHmac, randomUUID } from 'node:crypto';

/**
 * Signature des requêtes Tuya Cloud (HMAC-SHA256).
 *
 * Écart assumé avec le CDC §3, qui recommandait `@tuya/tuya-connector-nodejs` :
 * ce paquet n'a pas été publié depuis avril 2022 et reste sur axios 0.x. Faire
 * dépendre l'authentification de toute la plateforme d'une bibliothèque non
 * maintenue est un risque disproportionné face à ~40 lignes déterministes, que
 * l'on peut tester et corriger soi-même.
 *
 * Algorithme documenté par Tuya :
 *   stringToSign = METHOD \n SHA256(body) \n headersString \n path?query
 *   str          = clientId [+ accessToken] + t + nonce + stringToSign
 *   sign         = HMAC-SHA256(str, secret) en hexadécimal MAJUSCULE
 *
 * L'`accessToken` est absent des requêtes d'obtention de jeton, présent partout
 * ailleurs — c'est la seule différence entre les deux cas.
 */

export type SignedRequest = {
  url: string;
  headers: Record<string, string>;
};

export type SignInput = {
  clientId: string;
  clientSecret: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Chemin avec sa chaîne de requête, ex. `/v1.0/token?grant_type=1`. */
  path: string;
  body?: string;
  accessToken?: string;
  /** Injectables pour rendre la signature reproductible en test. */
  t?: number;
  nonce?: string;
};

const EMPTY_BODY_SHA256 = createHash('sha256').update('').digest('hex');

export function sha256(content: string): string {
  return content === '' ? EMPTY_BODY_SHA256 : createHash('sha256').update(content, 'utf8').digest('hex');
}

export function buildStringToSign(method: string, path: string, body: string): string {
  // Le champ des en-têtes signés reste vide : on ne déclare aucun en-tête
  // additionnel via `Signature-Headers`. La ligne doit néanmoins exister.
  return [method.toUpperCase(), sha256(body), '', path].join('\n');
}

export function signRequest(input: SignInput): SignedRequest & { sign: string; t: string } {
  const body = input.body ?? '';
  const t = String(input.t ?? Date.now());
  const nonce = input.nonce ?? randomUUID();

  const stringToSign = buildStringToSign(input.method, input.path, body);
  const payload = input.clientId + (input.accessToken ?? '') + t + nonce + stringToSign;
  const sign = createHmac('sha256', input.clientSecret).update(payload, 'utf8').digest('hex').toUpperCase();

  const headers: Record<string, string> = {
    client_id: input.clientId,
    sign,
    t,
    nonce,
    sign_method: 'HMAC-SHA256',
    'Content-Type': 'application/json',
  };
  if (input.accessToken) headers.access_token = input.accessToken;

  return { url: input.path, headers, sign, t };
}
