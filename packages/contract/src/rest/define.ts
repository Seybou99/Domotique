import { z } from 'zod';
import { API_PREFIX } from '../primitives.js';

/**
 * Descripteur d'endpoint.
 *
 * Un endpoint est une **donnée**, pas une chaîne recopiée des deux côtés : le
 * backend en dérive ses validateurs, l'app son client typé. Ajouter une route
 * sans la déclarer ici la rend inutilisable côté app — c'est l'effet recherché.
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type Endpoint<
  Params extends z.ZodTypeAny = z.ZodTypeAny,
  Query extends z.ZodTypeAny = z.ZodTypeAny,
  Body extends z.ZodTypeAny = z.ZodTypeAny,
  Response extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  method: HttpMethod;
  /** Chemin relatif au préfixe de version, paramètres en `:snake_case`. */
  path: string;
  params: Params;
  query: Query;
  body: Body;
  response: Response;
  /** `user` = JWT requis. `none` = route publique (login, inscription). */
  auth: 'user' | 'none';
  summary: string;
};

const empty = z.object({});

export function defineEndpoint<
  Params extends z.ZodTypeAny = typeof empty,
  Query extends z.ZodTypeAny = typeof empty,
  Body extends z.ZodTypeAny = typeof empty,
  Response extends z.ZodTypeAny = typeof empty,
>(spec: {
  method: HttpMethod;
  path: string;
  summary: string;
  auth?: 'user' | 'none';
  params?: Params;
  query?: Query;
  body?: Body;
  response?: Response;
}): Endpoint<Params, Query, Body, Response> {
  return {
    method: spec.method,
    path: spec.path,
    summary: spec.summary,
    auth: spec.auth ?? 'user',
    params: (spec.params ?? empty) as Params,
    query: (spec.query ?? empty) as Query,
    body: (spec.body ?? empty) as Body,
    response: (spec.response ?? empty) as Response,
  };
}

export type EndpointParams<E> = E extends Endpoint<infer P, any, any, any> ? z.infer<P> : never;
export type EndpointQuery<E> = E extends Endpoint<any, infer Q, any, any> ? z.infer<Q> : never;
export type EndpointBody<E> = E extends Endpoint<any, any, infer B, any> ? z.infer<B> : never;
export type EndpointResponse<E> = E extends Endpoint<any, any, any, infer R> ? z.infer<R> : never;

/**
 * Construit l'URL complète d'un endpoint, préfixe de version compris.
 * Les valeurs de paramètres sont encodées — un nom de pièce contenant « / »
 * ne doit pas pouvoir fabriquer une route.
 */
export function buildPath(
  endpoint: Pick<Endpoint, 'path'>,
  params: Record<string, string | number> = {},
): string {
  const filled = endpoint.path.replace(/:([a-z_]+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Paramètre manquant « ${key} » pour ${endpoint.path}`);
    }
    return encodeURIComponent(String(value));
  });
  return `${API_PREFIX}${filled}`;
}
