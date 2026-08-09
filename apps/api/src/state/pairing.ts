import type Redis from 'ioredis';

/**
 * Sessions d'association Zigbee et limitation de débit.
 *
 * Deux états courts et volatils, qui n'ont rien à faire en base relationnelle :
 * une fenêtre `permit_join` dure 60 secondes et ne survit pas à un redémarrage.
 * Ils partagent le même stockage que l'état chaud (Redis en production, mémoire
 * en développement mono-instance).
 */

export type DiscoveredEntry = {
  external_id: string;
  suggested_name: string;
  kind: string;
  claimed: boolean;
};

export type PairingSessionState = {
  unitId: string;
  homeId: string;
  expiresAt: string;
  discovered: DiscoveredEntry[];
};

export interface PairingStore {
  open(session: PairingSessionState, ttlS: number): Promise<void>;
  get(unitId: string): Promise<PairingSessionState | null>;
  addDiscovered(unitId: string, entry: DiscoveredEntry): Promise<PairingSessionState | null>;
  close(unitId: string): Promise<void>;
}

export class MemoryPairingStore implements PairingStore {
  private readonly sessions = new Map<string, { state: PairingSessionState; expiresAt: number }>();

  async open(session: PairingSessionState, ttlS: number) {
    this.sessions.set(session.unitId, { state: session, expiresAt: Date.now() + ttlS * 1000 });
  }

  async get(unitId: string) {
    const entry = this.sessions.get(unitId);
    if (!entry) return null;
    // Expiration paresseuse : pas de minuteur à nettoyer au redémarrage.
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(unitId);
      return null;
    }
    return entry.state;
  }

  async addDiscovered(unitId: string, discovered: DiscoveredEntry) {
    const state = await this.get(unitId);
    if (!state) return null;
    if (!state.discovered.some((d) => d.external_id === discovered.external_id)) {
      state.discovered.push(discovered);
    }
    return state;
  }

  async close(unitId: string) {
    this.sessions.delete(unitId);
  }
}

export class RedisPairingStore implements PairingStore {
  constructor(private readonly redis: Redis) {}

  private key(unitId: string) {
    return `pairing:${unitId}`;
  }

  async open(session: PairingSessionState, ttlS: number) {
    await this.redis.set(this.key(session.unitId), JSON.stringify(session), 'EX', ttlS);
  }

  async get(unitId: string) {
    const raw = await this.redis.get(this.key(unitId));
    return raw ? (JSON.parse(raw) as PairingSessionState) : null;
  }

  async addDiscovered(unitId: string, discovered: DiscoveredEntry) {
    const state = await this.get(unitId);
    if (!state) return null;
    if (!state.discovered.some((d) => d.external_id === discovered.external_id)) {
      state.discovered.push(discovered);
    }
    // On conserve le TTL restant : réécrire sans `KEEPTTL` prolongerait la
    // fenêtre d'association à chaque appareil détecté.
    await this.redis.set(this.key(unitId), JSON.stringify(state), 'KEEPTTL');
    return state;
  }

  async close(unitId: string) {
    await this.redis.del(this.key(unitId));
  }
}

/**
 * Limitation de débit (CDC §7).
 *
 * Utilisée sur le claim : sans elle, le code d'appairage à six caractères du QR
 * code serait devinable par force brute en quelques minutes.
 */
export interface RateLimiter {
  /** Renvoie `null` si autorisé, ou le nombre de secondes à attendre. */
  hit(key: string, limit: number, windowS: number): Promise<number | null>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowS: number) {
    const now = Date.now();
    const entry = this.counters.get(key);
    if (!entry || now > entry.resetAt) {
      this.counters.set(key, { count: 1, resetAt: now + windowS * 1000 });
      return null;
    }
    entry.count += 1;
    if (entry.count > limit) return Math.ceil((entry.resetAt - now) / 1000);
    return null;
  }
}

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowS: number) {
    const redisKey = `rl:${key}`;
    // `INCR` puis `EXPIRE` seulement à la première occurrence : poser le TTL à
    // chaque appel ferait glisser la fenêtre indéfiniment.
    const count = await this.redis.incr(redisKey);
    if (count === 1) await this.redis.expire(redisKey, windowS);
    if (count > limit) return (await this.redis.ttl(redisKey)) || windowS;
    return null;
  }
}
