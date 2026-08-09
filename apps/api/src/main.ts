import { setDefaultResultOrder } from 'node:dns';
import { loadEnv } from './env.js';
import { createContext } from './context.js';
import { buildServer } from './server.js';

/**
 * Résolution DNS en IPv4 d'abord.
 *
 * L'allowlist du projet Tuya n'accepte que des adresses IPv4 — sa propre
 * interface l'indique : « IPV6 configuration is not supported currently ».
 * Sur un réseau à double pile, Node sortirait en IPv6 et l'appel serait refusé
 * quelle que soit la configuration de l'allowlist.
 */
setDefaultResultOrder('ipv4first');

const env = loadEnv();
const ctx = createContext(env);
const stopConnectors = ctx.devices.start();
const stopPairing = ctx.pairing.start();
const stopScheduler = ctx.scheduler.start();
const app = await buildServer(ctx);

await app.listen({ port: env.PORT, host: '0.0.0.0' });
app.log.info(`API prête sur http://localhost:${env.PORT}/v1`);

/**
 * Filet de sécurité, pas une excuse.
 *
 * Node arrête le processus sur un rejet non capturé. Pour un serveur, tomber
 * parce qu'une tâche de fond a hoqueté est pire que de le journaliser : les
 * requêtes en cours seraient coupées et toute la flotte d'apps se reconnecterait
 * d'un coup. Chaque site asynchrone doit malgré tout gérer ses erreurs — ce
 * gestionnaire n'est là que pour ce qu'on aura oublié.
 */
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'rejet de promesse non capturé');
});

/**
 * Arrêt propre : sans cela, un redéploiement coupe les requêtes en vol et laisse
 * des connexions PostgreSQL ouvertes jusqu'à leur expiration.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} reçu, arrêt en cours`);
    stopConnectors();
    stopPairing();
    stopScheduler();
    await app.close();
    await ctx.close();
    process.exit(0);
  });
}
