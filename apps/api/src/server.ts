import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Ctx } from './context.js';
import { registerAuthRoutes } from './modules/auth.routes.js';
import { registerHomeRoutes } from './modules/homes.routes.js';
import { registerRoomRoutes } from './modules/rooms.routes.js';
import { registerDeviceRoutes } from './modules/devices.routes.js';
import { registerUnitRoutes } from './modules/units.routes.js';
import { registerAutomationRoutes } from './modules/automations.routes.js';
import { registerIntegrationRoutes } from './modules/integrations.routes.js';
import { registerAlertRoutes } from './modules/alerts.routes.js';
import { registerRealtime } from './modules/realtime.js';

/**
 * Assemblage du serveur.
 *
 * Écart assumé avec le CDC §3, qui recommandait « NestJS ou Express » : Fastify
 * + composition explicite. Raison : le contrat porte déjà les schémas et les
 * descripteurs de route, donc l'apport de NestJS se réduirait à son conteneur
 * d'injection — au prix des décorateurs, de `emitDecoratorMetadata` et d'une
 * chaîne de test à configurer (esbuild ne gère pas les métadonnées de
 * décorateurs). Ici les handlers sont des fonctions pures testables telles
 * quelles. Le §3 autorise explicitement cette alternative.
 */
export async function buildServer(ctx: Ctx): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: ctx.env.NODE_ENV === 'test' ? 'silent' : 'info',
      serializers: {
        // Le canal temps réel transporte le jeton en paramètre de requête : sans
        // cette rédaction, tous les access tokens finiraient dans les journaux.
        req(request: { method: string; url: string }) {
          return { method: request.method, url: redactToken(request.url) };
        },
      },
    },
    // Les identifiants d'appareil et de foyer sont des UUID : pas d'ambiguïté de
    // casse dans les chemins.
    routerOptions: { caseSensitive: true },
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get('/health', async () => ({ status: 'ok' }));

  registerAuthRoutes(app, ctx);
  registerHomeRoutes(app, ctx);
  registerRoomRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerUnitRoutes(app, ctx);
  registerAutomationRoutes(app, ctx);
  registerIntegrationRoutes(app, ctx);
  registerAlertRoutes(app, ctx);
  registerRealtime(app, ctx);

  return app;
}

export function redactToken(url: string): string {
  return url.replace(/([?&]access_token=)[^&]*/, '$1[redacted]');
}
