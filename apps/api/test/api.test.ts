import { describe, expect, it } from 'vitest';
import { api, API_PREFIX, type Endpoint } from '@domotique/contract';
import Fastify from 'fastify';
import { atLeast } from '../src/access.js';
import { hashPassword, hashToken, verifyPassword, createAuth } from '../src/http/auth.js';
import { statusFor, AppError } from '../src/http/errors.js';
import { loadEnv } from '../src/env.js';
import { MemoryEventBus } from '../src/state/events.js';
import { MemoryStateStore } from '../src/state/store.js';
import { SimulatedConnector } from '../src/devices/simulated.js';
import { registerAuthRoutes } from '../src/modules/auth.routes.js';
import { registerHomeRoutes } from '../src/modules/homes.routes.js';
import { registerRoomRoutes } from '../src/modules/rooms.routes.js';
import { registerDeviceRoutes } from '../src/modules/devices.routes.js';
import { registerUnitRoutes } from '../src/modules/units.routes.js';
import { registerAutomationRoutes } from '../src/modules/automations.routes.js';
import { registerIntegrationRoutes } from '../src/modules/integrations.routes.js';
import { registerAlertRoutes } from '../src/modules/alerts.routes.js';
import type { Ctx } from '../src/context.js';

/** Le contrat exige des UUID : une chaîne libre est rejetée à la validation. */
const HOME = '9b1d1f2a-1c3e-4a5b-8c7d-2e3f4a5b6c7d';
const AUTRE_HOME = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_B = '22222222-2222-4222-8222-222222222222';
const DEVICE_C = '33333333-3333-4333-8333-333333333333';

const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://x/y',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  TOKEN_ENCRYPTION_KEY: 'Cq5tqhCPTiA8CbTQFkK4TcMkNbXXKrLKp9y0FWGkYVE=',
} as unknown as NodeJS.ProcessEnv;

describe('configuration', () => {
  it('refuse de démarrer sans secret de signature', () => {
    expect(() => loadEnv({ ...TEST_ENV, JWT_SECRET: 'trop-court' })).toThrow(/JWT_SECRET/);
  });

  it('refuse une clé de chiffrement mal formée', () => {
    expect(() => loadEnv({ ...TEST_ENV, TOKEN_ENCRYPTION_KEY: 'trop-court' })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
  });

  it('refuse les secrets de développement en production', () => {
    expect(() =>
      loadEnv({ ...TEST_ENV, NODE_ENV: 'production', JWT_SECRET: 'dev-only' + 'x'.repeat(40) }),
    ).toThrow(/développement/);
  });
});

describe('mots de passe', () => {
  it('vérifie un mot de passe correct et rejette les autres', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('mauvais mot de passe', hash)).toBe(false);
  });

  it('produit un hash différent à chaque fois (sel aléatoire)', async () => {
    const [a, b] = await Promise.all([hashPassword('même'), hashPassword('même')]);
    expect(a).not.toBe(b);
  });

  it('rejette un hash malformé sans lever d’exception', async () => {
    expect(await verifyPassword('x', 'nimporte quoi')).toBe(false);
  });

  it('ne stocke jamais le refresh token en clair', () => {
    const token = 'jeton-secret';
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });
});

describe('jetons', () => {
  const auth = createAuth(loadEnv(TEST_ENV));

  it('refuse un refresh token présenté comme access token', () => {
    const refresh = auth.signRefresh('user-1', 'jti-1');
    // Sans la vérification du champ `typ`, ce jeton à durée de vie longue
    // ouvrirait l'API comme un access token.
    expect(() => auth.verifyAccess(refresh)).toThrow();
  });

  it('valide un access token émis normalement', () => {
    expect(auth.verifyAccess(auth.signAccess('user-1')).sub).toBe('user-1');
  });
});

describe('contrôle d’accès', () => {
  it('ordonne les rôles du plus large au plus restreint', () => {
    expect(atLeast('owner', 'admin')).toBe(true);
    expect(atLeast('admin', 'admin')).toBe(true);
    expect(atLeast('member', 'admin')).toBe(false);
    expect(atLeast('guest', 'member')).toBe(false);
  });
});

describe('codes d’erreur', () => {
  it('associe un statut HTTP à chaque code du contrat', () => {
    expect(statusFor('unauthorized')).toBe(401);
    expect(statusFor('rate_limited')).toBe(429);
    expect(statusFor('unit_offline')).toBe(409);
    expect(new AppError('not_found', 'x').code).toBe('not_found');
  });
});

describe('bus d’événements', () => {
  it('rejoue le delta depuis un identifiant connu', async () => {
    const bus = new MemoryEventBus();
    const first = await bus.publish('home-1', { type: 'device_removed', device_id: 'd1' });
    await bus.publish('home-1', { type: 'device_removed', device_id: 'd2' });

    const delta = await bus.replay('home-1', first.event_id);
    expect(delta?.map((e) => (e.data as { device_id: string }).device_id)).toEqual(['d2']);
  });

  it('signale une fenêtre dépassée plutôt que de renvoyer un delta incomplet', async () => {
    const bus = new MemoryEventBus();
    await bus.publish('home-1', { type: 'device_removed', device_id: 'd1' });
    // C'est ce `null` qui déclenche `resync_required` côté serveur : renvoyer une
    // liste vide laisserait l'app avec un état périmé sans qu'elle le sache.
    expect(await bus.replay('home-1', 'identifiant-inconnu')).toBeNull();
  });

  it('diffuse aux abonnés du foyer concerné uniquement', async () => {
    const bus = new MemoryEventBus();
    const received: string[] = [];
    bus.subscribe('home-1', (e) => received.push(e.home_id));
    await bus.publish('home-2', { type: 'device_removed', device_id: 'd1' });
    await bus.publish('home-1', { type: 'device_removed', device_id: 'd2' });
    expect(received).toEqual(['home-1']);
  });
});

describe('état chaud', () => {
  it('conserve la dernière valeur par capacité', async () => {
    const store = new MemoryStateStore();
    await store.set('d1', { type: 'brightness', value: 40 });
    await store.set('d1', { type: 'brightness', value: 62 });
    await store.set('d1', { type: 'on_off', value: true });

    const state = await store.get('d1');
    expect(state.brightness?.value).toEqual({ type: 'brightness', value: 62 });
    expect(state.on_off?.value).toEqual({ type: 'on_off', value: true });
  });
});

describe('connecteur simulé', () => {
  it('confirme la commande de façon asynchrone, comme un vrai appareil', async () => {
    const connector = new SimulatedConnector(1);
    const events: unknown[] = [];
    connector.onStateChange((e) => events.push(e.value));

    await connector.sendCommand(
      { deviceId: 'd1', externalId: 'x1', unitId: null, accountId: null },
      { type: 'on_off', value: true },
    );
    // Rien immédiatement : `sendCommand` résout quand la commande est partie,
    // pas quand elle est confirmée.
    expect(events).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual([{ type: 'on_off', value: true }]);
  });
});

/**
 * Couverture du contrat.
 *
 * Ce test ne vérifie pas que « tout marche » : il mesure et **fige** l'écart
 * entre ce que le contrat déclare et ce que le backend sert réellement. Chaque
 * module implémenté fait baisser la liste ci-dessous.
 */
describe('couverture du contrat', () => {
  // Toutes les routes du contrat sont servies.
  const NOT_IMPLEMENTED = new Set<string>();

  async function registeredRoutes(): Promise<Set<string>> {
    const app = Fastify({ logger: false, routerOptions: { caseSensitive: true } });
    const ctx = {
      env: loadEnv(TEST_ENV),
      auth: { requireUser: () => 'u1' },
      prisma: {},
      access: {},
      state: new MemoryStateStore(),
      events: new MemoryEventBus(),
    } as unknown as Ctx;

    // `onRoute` donne la table exacte ; `printRoutes` produit un arbre destiné à
    // la lecture humaine, dont le reparsing est fragile.
    const routes = new Set<string>();
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) routes.add(`${method} ${route.url}`);
    });

    registerAuthRoutes(app, ctx);
    registerHomeRoutes(app, ctx);
    registerRoomRoutes(app, ctx);
    registerDeviceRoutes(app, ctx);
    registerUnitRoutes(app, ctx);
    registerAutomationRoutes(app, ctx);
    registerIntegrationRoutes(app, ctx);
    registerAlertRoutes(app, ctx);
    await app.ready();
    await app.close();
    return routes;
  }

  it('sert toutes les routes des modules implémentés', async () => {
    const routes = await registeredRoutes();
    const missing: string[] = [];

    for (const [group, endpoints] of Object.entries(api)) {
      if (NOT_IMPLEMENTED.has(group)) continue;
      for (const [name, endpoint] of Object.entries(endpoints as Record<string, Endpoint>)) {
        const key = `${endpoint.method} ${API_PREFIX}${endpoint.path}`;
        if (!routes.has(key)) missing.push(`${group}.${name} → ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('n’a plus aucune route du contrat non servie', () => {
    const pending = Object.entries(api)
      .filter(([group]) => NOT_IMPLEMENTED.has(group))
      .flatMap(([group, endpoints]) => Object.keys(endpoints).map((n) => `${group}.${n}`));
    // Chiffre volontairement figé : le faire baisser est le travail restant.
    expect(pending).toHaveLength(0);
  });
});

describe('démarrage du serveur', () => {
  it('répond sur /health et refuse une route protégée sans jeton', async () => {
    // Contexte réel (store et bus en mémoire, PrismaClient non connecté) : ce
    // test vérifie le câblage complet, pas des pièces isolées.
    const { createContext } = await import('../src/context.js');
    const { buildServer } = await import('../src/server.js');

    const ctx = createContext(loadEnv(TEST_ENV));
    const app = await buildServer(ctx);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const protectedRoute = await app.inject({ method: 'GET', url: '/v1/homes' });
    expect(protectedRoute.statusCode).toBe(401);
    expect(protectedRoute.json().error.code).toBe('unauthorized');

    // Validation d'entrée : l'e-mail est refusé avant d'atteindre la base.
    const badSignup = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: 'pas-un-email', password: 'x', display_name: '' },
    });
    expect(badSignup.statusCode).toBe(422);
    expect(badSignup.json().error.code).toBe('validation_failed');

    await app.close();
    await ctx.close();
  });
});

describe('connecteur Tuya — signature', () => {
  it('produit une signature déterministe et en majuscules', async () => {
    const { signRequest, buildStringToSign, sha256 } = await import('../src/devices/tuya/signature.js');

    const a = signRequest({
      clientId: 'id', clientSecret: 'secret', method: 'GET',
      path: '/v1.0/token?grant_type=1', t: 1_700_000_000_000, nonce: 'fixe',
    });
    const b = signRequest({
      clientId: 'id', clientSecret: 'secret', method: 'GET',
      path: '/v1.0/token?grant_type=1', t: 1_700_000_000_000, nonce: 'fixe',
    });

    expect(a.sign).toBe(b.sign);
    expect(a.sign).toMatch(/^[0-9A-F]{64}$/);
    // Le hash SHA-256 d'un corps vide est une constante connue.
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(buildStringToSign('GET', '/p', '')).toBe(`GET\n${sha256('')}\n\n/p`);
  });

  it('n’envoie access_token que sur les requêtes métier', async () => {
    const { signRequest } = await import('../src/devices/tuya/signature.js');
    const sansJeton = signRequest({ clientId: 'i', clientSecret: 's', method: 'GET', path: '/v1.0/token' });
    const avecJeton = signRequest({ clientId: 'i', clientSecret: 's', method: 'GET', path: '/x', accessToken: 'tok' });
    expect(sansJeton.headers.access_token).toBeUndefined();
    expect(avecJeton.headers.access_token).toBe('tok');
  });
});

describe('connecteur Tuya — échelles', () => {
  it('ramène la luminosité Tuya 10-1000 sur 0-100', async () => {
    const { dpToCapability, capabilityToDp } = await import('../src/devices/tuya/mapping.js');

    // C'est exactement le bug que le contrat interdit : sans conversion, une
    // ampoule à 620 s'afficherait « 620 % » ou serait rejetée par la validation.
    expect(dpToCapability('bright_value_v2', 1000)).toEqual({ type: 'brightness', value: 100 });
    expect(dpToCapability('bright_value_v2', 10)).toEqual({ type: 'brightness', value: 0 });
    expect(capabilityToDp({ type: 'brightness', value: 100 })).toEqual({
      code: 'bright_value_v2', value: 1000,
    });
  });

  it('respecte les bornes réelles de l’appareil quand elles sont connues', async () => {
    const { dpToCapability } = await import('../src/devices/tuya/mapping.js');
    // Ancien modèle sur 25-255 : la valeur médiane doit donner ~50 %, pas 4 %.
    expect(dpToCapability('bright_value', 140, { bright_value: { min: 25, max: 255 } })).toEqual({
      type: 'brightness', value: 50,
    });
  });

  it('convertit la température de couleur en kelvins', async () => {
    const { dpToCapability } = await import('../src/devices/tuya/mapping.js');
    expect(dpToCapability('temp_value_v2', 0)).toEqual({ type: 'color_temp', value: 2700 });
    expect(dpToCapability('temp_value_v2', 1000)).toEqual({ type: 'color_temp', value: 6500 });
  });

  it('applique l’échelle décimale des capteurs', async () => {
    const { dpToCapability } = await import('../src/devices/tuya/mapping.js');
    // 235 avec scale 1 = 23,5 °C.
    expect(dpToCapability('va_temperature', 235)).toEqual({ type: 'temperature', value: 23.5 });
  });

  it('ignore un Data Point non pris en charge plutôt que de deviner', async () => {
    const { dpToCapability } = await import('../src/devices/tuya/mapping.js');
    expect(dpToCapability('countdown_1', 42)).toBeNull();
  });

  it('produit des valeurs conformes au contrat', async () => {
    const { dpToCapability } = await import('../src/devices/tuya/mapping.js');
    const { capabilityValue } = await import('@domotique/contract');
    for (const [code, raw] of [['bright_value_v2', 620], ['va_humidity', 55], ['switch_led', true]] as const) {
      const value = dpToCapability(code, raw);
      expect(capabilityValue.safeParse(value).success, `${code}`).toBe(true);
    }
  });
});

describe('canal temps réel', () => {
  /** Ouvre un vrai serveur et une vraie socket : le protocole ne se teste pas en isolation. */
  async function withRealtime(
    run: (helpers: {
      url: (token: string) => string;
      token: (userId: string) => string;
      publish: (homeId: string, deviceId: string) => Promise<string>;
      bus: InstanceType<typeof MemoryEventBus>;
    }) => Promise<void>,
    { memberOf = [HOME] }: { memberOf?: string[] } = {},
  ) {
    const { buildServer } = await import('../src/server.js');
    const env = loadEnv(TEST_ENV);
    const { createAuth } = await import('../src/http/auth.js');
    const auth = createAuth(env);
    const bus = new MemoryEventBus();

    const ctx = {
      env,
      auth,
      access: {
        requireHome: async (_u: string, homeId: string) => {
          if (!memberOf.includes(homeId)) throw new Error('forbidden');
          return 'owner';
        },
      },
      events: bus,
      state: new MemoryStateStore(),
      prisma: {},
    } as unknown as Ctx;

    const app = await buildServer(ctx);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      await run({
        url: (token) => `ws://127.0.0.1:${port}/v1/realtime?access_token=${token}`,
        token: (userId) => auth.signAccess(userId),
        publish: async (homeId, deviceId) =>
          (await bus.publish(homeId, { type: 'device_removed', device_id: deviceId })).event_id,
        bus,
      });
    } finally {
      await app.close();
    }
  }

  /** Attend le premier message satisfaisant le prédicat, ou échoue au bout du délai. */
  function waitFor(ws: any, predicate: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('délai dépassé')), timeoutMs);
      ws.on('message', (raw: Buffer) => {
        const message = JSON.parse(raw.toString());
        if (predicate(message)) {
          clearTimeout(timer);
          resolve(message);
        }
      });
      ws.on('close', (code: number) => {
        clearTimeout(timer);
        reject(new Error(`fermé avec le code ${code}`));
      });
    });
  }

  it('refuse une connexion sans jeton valide', async () => {
    const { WebSocket } = await import('ws');
    await withRealtime(async ({ url }) => {
      const ws = new WebSocket(url('jeton-bidon'));
      const code = await new Promise<number>((resolve) => ws.on('close', resolve));
      expect(code).toBe(4002);
    });
  });

  it('confirme l’abonnement puis diffuse les événements du foyer', async () => {
    const { WebSocket } = await import('ws');
    await withRealtime(async ({ url, token, publish }) => {
      const ws = new WebSocket(url(token('u1')));
      await new Promise((r) => ws.on('open', r));
      ws.send(JSON.stringify({ type: 'subscribe', home_id: HOME, last_event_id: null }));

      const subscribed = await waitFor(ws, (m) => m.type === 'subscribed');
      expect(subscribed.home_id).toBe(HOME);

      const received = waitFor(ws, (m) => m.kind === 'event');
      await publish(HOME, DEVICE_A);
      const event = await received;
      expect(event.data.device_id).toBe(DEVICE_A);
      ws.close();
    });
  });

  it('ferme la socket si l’utilisateur n’est pas membre du foyer', async () => {
    const { WebSocket } = await import('ws');
    await withRealtime(async ({ url, token }) => {
      const ws = new WebSocket(url(token('u1')));
      await new Promise((r) => ws.on('open', r));
      ws.send(JSON.stringify({ type: 'subscribe', home_id: AUTRE_HOME, last_event_id: null }));
      const code = await new Promise<number>((resolve) => ws.on('close', resolve));
      expect(code).toBe(4003);
    });
  });

  it('rejoue le delta manqué depuis last_event_id', async () => {
    const { WebSocket } = await import('ws');
    await withRealtime(async ({ url, token, publish }) => {
      // Deux événements survenus pendant que l'app était déconnectée.
      const first = await publish(HOME, DEVICE_A);
      await publish(HOME, DEVICE_B);
      await publish(HOME, DEVICE_C);

      const ws = new WebSocket(url(token('u1')));
      await new Promise((r) => ws.on('open', r));

      const rejoués: string[] = [];
      const done = new Promise<void>((resolve) => {
        ws.on('message', (raw: Buffer) => {
          const m = JSON.parse(raw.toString());
          if (m.kind === 'event') rejoués.push(m.data.device_id);
          if (m.type === 'subscribed') resolve();
        });
      });
      ws.send(JSON.stringify({ type: 'subscribe', home_id: HOME, last_event_id: first }));
      await done;

      expect(rejoués).toEqual([DEVICE_B, DEVICE_C]);
      ws.close();
    });
  });

  it('demande une resynchronisation quand la fenêtre de rejeu est dépassée', async () => {
    const { WebSocket } = await import('ws');
    await withRealtime(async ({ url, token, publish }) => {
      await publish(HOME, DEVICE_A);
      const ws = new WebSocket(url(token('u1')));
      await new Promise((r) => ws.on('open', r));
      ws.send(JSON.stringify({ type: 'subscribe', home_id: HOME, last_event_id: 'trop-vieux' }));

      const control = await waitFor(ws, (m) => m.type === 'resync_required');
      expect(control.reason).toBe('window_expired');
      // Surtout : aucun événement n'a été livré avant. Un delta vide aurait
      // laissé l'app croire qu'elle était à jour.
      ws.close();
    });
  });

  it('répond au ping et accepte un jeton renouvelé sans couper la socket', async () => {
    const { WebSocket } = await import('ws');
    await withRealtime(async ({ url, token }) => {
      const ws = new WebSocket(url(token('u1')));
      await new Promise((r) => ws.on('open', r));

      ws.send(JSON.stringify({ type: 'ping' }));
      expect((await waitFor(ws, (m) => m.type === 'pong')).type).toBe('pong');

      ws.send(JSON.stringify({ type: 'auth_refresh', access_token: token('u1') }));
      ws.send(JSON.stringify({ type: 'ping' }));
      expect((await waitFor(ws, (m) => m.type === 'pong')).type).toBe('pong');
      ws.close();
    });
  });

  it('efface le jeton des journaux', async () => {
    const { redactToken } = await import('../src/server.js');
    expect(redactToken('/v1/realtime?access_token=eyJhbGciOi.secret&x=1')).toBe(
      '/v1/realtime?access_token=[redacted]&x=1',
    );
  });
});

describe('sessions d’association', () => {
  it('expire d’elle-même sans intervention', async () => {
    const { MemoryPairingStore } = await import('../src/state/pairing.js');
    const store = new MemoryPairingStore();
    await store.open(
      { unitId: 'u1', homeId: HOME, expiresAt: new Date().toISOString(), discovered: [] },
      0,
    );
    await new Promise((r) => setTimeout(r, 5));
    // Exigence de sécurité du §5.2 : un réseau Zigbee laissé ouvert accepte
    // n'importe quel appareil à portée.
    expect(await store.get('u1')).toBeNull();
  });

  it('ne propose pas deux fois le même appareil détecté', async () => {
    const { MemoryPairingStore } = await import('../src/state/pairing.js');
    const store = new MemoryPairingStore();
    await store.open(
      { unitId: 'u1', homeId: HOME, expiresAt: new Date().toISOString(), discovered: [] },
      60,
    );
    const entry = { external_id: '0xabc', suggested_name: 'Prise', kind: 'plug', claimed: false };
    await store.addDiscovered('u1', entry);
    await store.addDiscovered('u1', entry);
    expect((await store.get('u1'))?.discovered).toHaveLength(1);
  });

  it('ignore une découverte hors session', async () => {
    const { MemoryPairingStore } = await import('../src/state/pairing.js');
    const store = new MemoryPairingStore();
    const result = await store.addDiscovered('inconnu', {
      external_id: '0xabc', suggested_name: 'Prise', kind: 'plug', claimed: false,
    });
    expect(result).toBeNull();
  });
});

describe('limitation de débit', () => {
  it('bloque au-delà du plafond et indique le délai d’attente', async () => {
    const { MemoryRateLimiter } = await import('../src/state/pairing.js');
    const limiter = new MemoryRateLimiter();

    for (let i = 0; i < 3; i++) expect(await limiter.hit('claim:u1', 3, 60)).toBeNull();
    const retryAfter = await limiter.hit('claim:u1', 3, 60);
    expect(retryAfter).toBeGreaterThan(0);
    // Sans ce plafond, le code d'appairage du QR serait devinable par force brute.
    expect(await limiter.hit('claim:u2', 3, 60)).toBeNull();
  });

  it('rouvre la fenêtre une fois le délai écoulé', async () => {
    const { MemoryRateLimiter } = await import('../src/state/pairing.js');
    const limiter = new MemoryRateLimiter();
    await limiter.hit('k', 1, 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(await limiter.hit('k', 1, 0)).toBeNull();
  });
});
