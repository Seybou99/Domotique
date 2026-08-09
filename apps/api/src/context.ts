import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { Env } from './env.js';
import { createAuth, type Auth } from './http/auth.js';
import { createAccess, type Access } from './access.js';
import { MemoryStateStore, RedisStateStore, type StateStore } from './state/store.js';
import { MemoryEventBus, RedisEventBus, type EventBus } from './state/events.js';
import { ConnectorRegistry } from './devices/connector.js';
import { SimulatedConnector } from './devices/simulated.js';
import { DeviceService } from './devices/service.js';
import { PairingService } from './devices/pairing.js';
import { AutomationEngine } from './automations/engine.js';
import { AutomationScheduler } from './automations/scheduler.js';
import { TokenCipher } from './crypto/tokens.js';
import { ProviderRegistry } from './integrations/provider.js';
import { createTuyaProvider } from './integrations/tuya.provider.js';
import { SimulatedProvider } from './integrations/simulated.provider.js';
import { ThirdPartyAccounts } from './integrations/accounts.js';
import { TuyaConnector } from './devices/tuya/connector.js';
import { TuyaClient } from './devices/tuya/client.js';
import { CallBudget } from './integrations/budget.js';
import { MemoryTempStore, RedisTempStore, type TempStore } from './state/temp.js';
import {
  MemoryPairingStore,
  MemoryRateLimiter,
  RedisPairingStore,
  RedisRateLimiter,
  type PairingStore,
  type RateLimiter,
} from './state/pairing.js';

/**
 * Composition de l'application.
 *
 * Tout est construit ici et passé explicitement. Pas de conteneur d'injection :
 * le graphe est petit, et le voir en entier sur un écran vaut mieux que de le
 * deviner à travers des décorateurs.
 */
export type Ctx = {
  env: Env;
  prisma: PrismaClient;
  auth: Auth;
  access: Access;
  state: StateStore;
  events: EventBus;
  connectors: ConnectorRegistry;
  devices: DeviceService;
  pairing: PairingService;
  engine: AutomationEngine;
  scheduler: AutomationScheduler;
  limiter: RateLimiter;
  temp: TempStore;
  cipher: TokenCipher;
  providers: ProviderRegistry;
  accounts: ThirdPartyAccounts;
  close: () => Promise<void>;
};

export function createContext(env: Env): Ctx {
  const prisma = new PrismaClient();

  const closers: (() => Promise<void>)[] = [() => prisma.$disconnect()];

  let state: StateStore;
  let events: EventBus;
  let pairingStore: PairingStore;
  let limiter: RateLimiter;
  let temp: TempStore;

  if (env.REDIS_URL) {
    const redis = new Redis(env.REDIS_URL);
    const subscriber = new Redis(env.REDIS_URL);
    state = new RedisStateStore(redis);
    events = new RedisEventBus(redis, subscriber);
    pairingStore = new RedisPairingStore(redis);
    limiter = new RedisRateLimiter(redis);
    temp = new RedisTempStore(redis);
    closers.push(() => events.close());
  } else {
    // Mono-instance uniquement : deux instances avec un bus en mémoire ne se
    // verraient pas, et le rejeu serait perdu au redémarrage.
    if (env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL est requis en production (état chaud et bus d’événements).');
    }
    state = new MemoryStateStore();
    events = new MemoryEventBus();
    pairingStore = new MemoryPairingStore();
    limiter = new MemoryRateLimiter();
    temp = new MemoryTempStore();
  }

  const connectors = new ConnectorRegistry();
  if (env.NODE_ENV !== 'production') {
    // Tant que le connecteur MQTT n'existe pas, le simulé permet de valider la
    // boucle complète commande → événement → interface.
    connectors.register(new SimulatedConnector());
  }

  const devices = new DeviceService(prisma, connectors, state, events);
  const pairing = new PairingService(prisma, connectors, pairingStore, events);
  const cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY);

  const providers = new ProviderRegistry();
  const tuya = createTuyaProvider(env);
  if (tuya) providers.register(tuya);
  if (env.NODE_ENV !== 'production') {
    // Enregistré sous `hue`, dont le connecteur réel arrive en V2 : le flux
    // OAuth complet est ainsi testable sans dépendre d'un tiers, et sans
    // qu'un faux compte puisse passer pour un vrai compte Tuya.
    providers.register(new SimulatedProvider());
  }

  const accounts = new ThirdPartyAccounts(prisma, providers, cipher, events);

  if (env.TUYA_ACCESS_ID && env.TUYA_ACCESS_SECRET) {
    const tuyaClient = new TuyaClient({
      accessId: env.TUYA_ACCESS_ID,
      accessSecret: env.TUYA_ACCESS_SECRET,
      dataCenter: env.TUYA_DATA_CENTER,
    });
    connectors.register(
      new TuyaConnector(
        tuyaClient,
        (accountId) => accounts.accessToken(accountId),
        // Le connecteur ne connaît pas la base : on lui fournit la liste des
        // appareils à suivre, il ne sait qu'en faire des requêtes Tuya.
        async () => {
          const rows = await prisma.device.findMany({
            where: { protocol: 'tuya', accountId: { not: null } },
            select: { id: true, externalId: true, unitId: true, accountId: true },
          });
          return rows.map((row) => ({
            deviceId: row.id,
            externalId: row.externalId,
            unitId: row.unitId,
            accountId: row.accountId,
          }));
        },
        {
          pollIntervalMs: env.TUYA_POLL_INTERVAL_S * 1000,
          budget: new CallBudget(limiter, 'tuya'),
        },
      ),
    );
  }

  const engine = new AutomationEngine(prisma, devices, state, events);
  const scheduler = new AutomationScheduler(prisma, engine, events);
  devices.setStateListener((deviceId, homeId, value) => {
    // `.catch` obligatoire : ce travail est déclenché hors requête HTTP, un
    // rejet non capturé arrêterait le processus.
    scheduler.onDeviceState(deviceId, homeId, value).catch((error: unknown) => {
      console.error('[automations] échec d’un déclencheur par capteur :', error);
    });
  });

  return {
    env,
    prisma,
    auth: createAuth(env),
    access: createAccess(prisma),
    state,
    events,
    connectors,
    devices,
    pairing,
    engine,
    scheduler,
    limiter,
    temp,
    cipher,
    providers,
    accounts,
    close: async () => {
      for (const close of closers) await close();
    },
  };
}
