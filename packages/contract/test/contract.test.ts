import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  api,
  buildPath,
  capabilityValue,
  clientMessage,
  commandRequest,
  devices,
  serverMessage,
  thirdPartyAccount,
  type Endpoint,
} from '../src/index.js';

const allEndpoints: [string, Endpoint][] = Object.entries(api).flatMap(([group, endpoints]) =>
  Object.entries(endpoints).map(
    ([name, endpoint]): [string, Endpoint] => [`${group}.${name}`, endpoint as Endpoint],
  ),
);

describe('registre des endpoints', () => {
  it('déclare chaque paramètre de chemin dans le schéma params', () => {
    for (const [name, endpoint] of allEndpoints) {
      const inPath = [...endpoint.path.matchAll(/:([a-z_]+)/g)].map((m) => m[1]);
      const declared = Object.keys((endpoint.params as z.ZodObject<z.ZodRawShape>).shape ?? {});
      for (const param of inPath) {
        expect(declared, `${name} : « :${param} » absent du schéma params`).toContain(param);
      }
    }
  });

  it('n’expose pas deux fois le même couple méthode + chemin', () => {
    const seen = new Map<string, string>();
    for (const [name, endpoint] of allEndpoints) {
      const key = `${endpoint.method} ${endpoint.path}`;
      expect(seen.has(key), `${key} déclaré par ${seen.get(key)} et ${name}`).toBe(false);
      seen.set(key, name);
    }
  });

  it('exige un JWT partout sauf sur les routes d’entrée', () => {
    const publicRoutes = allEndpoints.filter(([, e]) => e.auth === 'none').map(([n]) => n);
    expect(publicRoutes.sort()).toEqual(['auth.login', 'auth.refresh', 'auth.signup']);
  });
});

describe('paramètres de requête', () => {
  it('accepte les nombres sous forme de chaîne — une URL n’en transporte pas d’autres', () => {
    const parsed = devices.history.query.parse({ limit: '50' });
    expect(parsed.limit).toBe(50);
  });

  it('n’accepte pas une limite hors bornes, même en chaîne', () => {
    expect(devices.history.query.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('déclare tout champ numérique de query en coercition', () => {
    // Garde-fou : un `z.number()` nu dans un schéma `query` casse en production
    // dès que le client passe le paramètre.
    for (const [group, endpoints] of Object.entries(api)) {
      for (const [name, endpoint] of Object.entries(endpoints as Record<string, Endpoint>)) {
        const shape = (endpoint.query as z.ZodObject<z.ZodRawShape>).shape ?? {};
        for (const [field, schema] of Object.entries(shape)) {
          const accepteChaine = schema.safeParse('1').success || !acceptsNumber(schema);
          expect(accepteChaine, `${group}.${name} → query.${field}`).toBe(true);
        }
      }
    }
  });
});

function acceptsNumber(schema: z.ZodTypeAny): boolean {
  return schema.safeParse(1).success;
}

describe('buildPath', () => {
  it('préfixe la version', () => {
    expect(buildPath(devices.list, { home_id: 'abc' })).toBe('/v1/homes/abc/devices');
  });

  it('encode les valeurs pour qu’un paramètre ne fabrique pas de route', () => {
    expect(buildPath(devices.get, { device_id: '../../admin' })).toBe(
      '/v1/devices/..%2F..%2Fadmin',
    );
  });

  it('échoue bruyamment sur un paramètre manquant', () => {
    expect(() => buildPath(devices.get, {})).toThrow(/device_id/);
  });
});

describe('normalisation des valeurs de capacité', () => {
  it('accepte une luminosité en pourcentage', () => {
    expect(capabilityValue.parse({ type: 'brightness', value: 62 })).toEqual({
      type: 'brightness',
      value: 62,
    });
  });

  it('rejette une échelle native Tuya (0-1000) — la conversion est au connecteur', () => {
    expect(capabilityValue.safeParse({ type: 'brightness', value: 620 }).success).toBe(false);
  });

  it('rejette un type mal apparié à sa valeur', () => {
    expect(capabilityValue.safeParse({ type: 'on_off', value: 62 }).success).toBe(false);
    expect(capabilityValue.safeParse({ type: 'contact', value: true }).success).toBe(false);
  });

  it('n’accepte pas une commande sur une capacité en lecture seule', () => {
    const readOnly = commandRequest.safeParse({
      command_id: '3f0a5f6e-3d4a-4d1e-8f8b-6f6b7a9c1d2e',
      target: { type: 'battery', value: 80 },
    });
    expect(readOnly.success).toBe(false);
  });
});

describe('étanchéité des comptes tiers', () => {
  it('ne laisse pas passer un token dans une réponse', () => {
    const parsed = thirdPartyAccount.parse({
      id: '3f0a5f6e-3d4a-4d1e-8f8b-6f6b7a9c1d2e',
      home_id: '9b1d1f2a-1c3e-4a5b-8c7d-2e3f4a5b6c7d',
      provider: 'tuya',
      account_label: 'camille@example.com',
      linked_by_user_id: '7c2e1f3a-5b6c-4d7e-8f9a-0b1c2d3e4f5a',
      linked_at: '2026-08-08T19:00:00Z',
      reauth_required: false,
      device_count: 4,
      // Ce que le connecteur pourrait laisser fuiter par inadvertance :
      access_token: 'tuya-secret',
      refresh_token: 'tuya-refresh',
    });
    expect(parsed).not.toHaveProperty('access_token');
    expect(parsed).not.toHaveProperty('refresh_token');
  });
});

describe('canal temps réel', () => {
  it('accepte un abonnement avec point de reprise', () => {
    const msg = clientMessage.parse({
      type: 'subscribe',
      home_id: '9b1d1f2a-1c3e-4a5b-8c7d-2e3f4a5b6c7d',
      last_event_id: '1754680000000-0',
    });
    expect(msg.type).toBe('subscribe');
  });

  it('distingue un événement métier d’un message de contrôle', () => {
    const event = serverMessage.parse({
      kind: 'event',
      event_id: '1754680000000-0',
      home_id: '9b1d1f2a-1c3e-4a5b-8c7d-2e3f4a5b6c7d',
      at: '2026-08-08T19:00:00Z',
      data: {
        type: 'device_state_changed',
        device_id: '3f0a5f6e-3d4a-4d1e-8f8b-6f6b7a9c1d2e',
        capability: { type: 'on_off', value: true },
        origin: { kind: 'automation', automation_id: '7c2e1f3a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', name: 'Soirée cinéma' },
      },
    });
    expect(event.kind).toBe('event');

    const control = serverMessage.parse({
      kind: 'control',
      type: 'resync_required',
      home_id: '9b1d1f2a-1c3e-4a5b-8c7d-2e3f4a5b6c7d',
      reason: 'window_expired',
    });
    expect(control.kind).toBe('control');
  });

  it('impose une origine sur tout changement d’état (écran 2.2)', () => {
    const sansOrigine = serverMessage.safeParse({
      kind: 'event',
      event_id: '1754680000000-0',
      home_id: '9b1d1f2a-1c3e-4a5b-8c7d-2e3f4a5b6c7d',
      at: '2026-08-08T19:00:00Z',
      data: {
        type: 'device_state_changed',
        device_id: '3f0a5f6e-3d4a-4d1e-8f8b-6f6b7a9c1d2e',
        capability: { type: 'on_off', value: true },
      },
    });
    expect(sansOrigine.success).toBe(false);
  });
});
