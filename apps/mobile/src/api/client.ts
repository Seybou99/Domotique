import {
  API_PREFIX,
  apiError,
  buildPath,
  type Endpoint,
  type EndpointBody,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResponse,
  type ErrorCode,
} from '@domotique/contract';

/**
 * Client HTTP dérivé du contrat.
 *
 * Il n'y a pas une seule URL écrite à la main dans l'app : `call()` prend un
 * descripteur d'endpoint et en déduit méthode, chemin, corps et type de réponse.
 * Ajouter une route inconnue du contrat ne compile pas.
 */

export class ApiException extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly retryAfterS?: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiException';
  }
}

export type ApiConfig = {
  /** Racine du backend, sans le préfixe de version — celui-ci vient du contrat. */
  baseUrl: string;
  /** Fournit l'access token courant ; `null` pour les routes publiques. */
  getAccessToken: () => string | null;
  /** Appelé sur 401 : doit renouveler puis renvoyer le nouveau token, ou `null`. */
  onUnauthorized?: () => Promise<string | null>;
};

export function createApiClient(config: ApiConfig) {
  async function call<E extends Endpoint>(
    endpoint: E,
    input: {
      params?: EndpointParams<E>;
      query?: EndpointQuery<E>;
      body?: EndpointBody<E>;
      signal?: AbortSignal;
    } = {},
    isRetry = false,
  ): Promise<EndpointResponse<E>> {
    const path = buildPath(endpoint, (input.params ?? {}) as Record<string, string>);
    const url = new URL(config.baseUrl.replace(/\/$/, '') + path);

    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (endpoint.auth === 'user') {
      const token = config.getAccessToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const hasBody = endpoint.method !== 'GET' && input.body !== undefined;
    if (hasBody) headers['content-type'] = 'application/json';

    const response = await fetch(url.toString(), {
      method: endpoint.method,
      headers,
      body: hasBody ? JSON.stringify(input.body) : undefined,
      signal: input.signal,
    });

    if (response.status === 401 && !isRetry && config.onUnauthorized) {
      const refreshed = await config.onUnauthorized();
      if (refreshed) return call(endpoint, input, true);
    }

    const payload: unknown = response.status === 204 ? {} : await response.json().catch(() => ({}));

    if (!response.ok) {
      const parsed = apiError.safeParse(payload);
      if (parsed.success) {
        const { code, message, retry_after_s, fields } = parsed.data.error;
        throw new ApiException(code, response.status, message, retry_after_s, fields);
      }
      throw new ApiException('internal_error', response.status, `HTTP ${response.status}`);
    }

    /**
     * On valide aussi les réponses, pas seulement les requêtes. C'est le filet
     * décrit au §12 du CDC : un champ brut échappé d'un connecteur est signalé
     * ici, au lieu de se propager silencieusement dans l'interface.
     */
    const result = endpoint.response.safeParse(payload);
    if (!result.success) {
      throw new ApiException(
        'internal_error',
        response.status,
        `Réponse non conforme au contrat pour ${endpoint.method} ${endpoint.path} : ${result.error.message}`,
      );
    }
    return result.data as EndpointResponse<E>;
  }

  return { call, apiPrefix: API_PREFIX };
}

export type ApiClient = ReturnType<typeof createApiClient>;
