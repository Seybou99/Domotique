import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  API_PREFIX,
  type Endpoint,
  type EndpointBody,
  type EndpointParams,
  type EndpointQuery,
  type EndpointResponse,
} from '@domotique/contract';
import { AppError, statusFor } from './errors.js';
import type { Ctx } from '../context.js';

/**
 * Enregistrement d'une route à partir de son descripteur de contrat.
 *
 * Le chemin, la méthode, les schémas d'entrée et de sortie viennent tous du
 * paquet partagé — rien n'est retapé ici. Une route qui dériverait du contrat ne
 * compile pas, et une réponse non conforme est refusée **avant** d'être envoyée
 * plutôt que découverte par l'app.
 */

export type Handler<E extends Endpoint> = (input: {
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
  /** `null` sur les routes publiques. */
  userId: string | null;
  ctx: Ctx;
  req: FastifyRequest;
  reply: FastifyReply;
}) => Promise<EndpointResponse<E>>;

/** Convertit `/homes/:home_id` en syntaxe Fastify (identique, mais explicite). */
function toFastifyPath(path: string): string {
  return `${API_PREFIX}${path}`;
}

export function registerRoute<E extends Endpoint>(
  app: FastifyInstance,
  ctx: Ctx,
  endpoint: E,
  handler: Handler<E>,
): void {
  app.route({
    method: endpoint.method,
    url: toFastifyPath(endpoint.path),
    handler: async (req, reply) => {
      try {
        const userId = endpoint.auth === 'user' ? ctx.auth.requireUser(req) : null;

        const params = parseOrThrow(endpoint.params, req.params, 'paramètre');
        const query = parseOrThrow(endpoint.query, normalizeQuery(req.query), 'paramètre de requête');
        const body = parseOrThrow(endpoint.body, req.body ?? {}, 'corps de requête');

        const result = await handler({
          params: params as EndpointParams<E>,
          query: query as EndpointQuery<E>,
          body: body as EndpointBody<E>,
          userId,
          ctx,
          req,
          reply,
        });

        // Validation de sortie : c'est ici que le filet du §12 se referme. Un
        // champ propre à Tuya échappé d'un connecteur est arrêté avant l'envoi.
        const checked = endpoint.response.safeParse(result);
        if (!checked.success) {
          req.log.error(
            { endpoint: endpoint.path, issues: checked.error.issues },
            'réponse non conforme au contrat',
          );
          throw new AppError('internal_error', 'Réponse non conforme au contrat');
        }
        return reply.send(checked.data);
      } catch (error) {
        return sendError(req, reply, error);
      }
    },
  });
}

function parseOrThrow(schema: z.ZodTypeAny, value: unknown, what: string) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
  throw new AppError('validation_failed', `${what} invalide`, fields);
}

/**
 * Une chaîne de requête n'a que des chaînes. On rétablit les booléens attendus
 * par les schémas (`?unread_only=true`) ; les nombres sont gérés par `z.coerce`
 * côté contrat.
 */
function normalizeQuery(query: unknown): unknown {
  if (typeof query !== 'object' || query === null) return query;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === 'true') out[key] = true;
    else if (value === 'false') out[key] = false;
    else out[key] = value;
  }
  return out;
}

function sendError(req: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(statusFor(error.code)).send({
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        ...(error.retryAfterS !== undefined ? { retry_after_s: error.retryAfterS } : {}),
      },
    });
  }
  req.log.error({ err: error }, 'erreur non gérée');
  return reply.status(500).send({
    error: { code: 'internal_error', message: 'Erreur interne' },
  });
}
