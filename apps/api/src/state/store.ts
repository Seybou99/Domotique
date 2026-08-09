import type Redis from 'ioredis';
import type { CapabilityValue } from '@domotique/contract';

/**
 * État chaud des capacités (CDC §6.4).
 *
 * La valeur courante ne vit **pas** dans PostgreSQL : à quelques milliers de
 * foyers, un `UPDATE` par relevé de capteur saturerait la base. Elle vit ici,
 * avec un TTL, et PostgreSQL n'en reçoit qu'un instantané périodique.
 *
 * Note de reprise : après une perte de Redis, ne pas servir l'instantané comme
 * vérité — la vérité est dans les appareils. Le bon réflexe est de déclencher un
 * `getState` sur les connecteurs ; l'instantané ne sert qu'à afficher quelque
 * chose en attendant.
 */

export type StoredValue = { value: CapabilityValue; updated_at: string };

export interface StateStore {
  get(deviceId: string): Promise<Record<string, StoredValue>>;
  getMany(deviceIds: string[]): Promise<Map<string, Record<string, StoredValue>>>;
  set(deviceId: string, value: CapabilityValue, at?: Date): Promise<StoredValue>;
  close(): Promise<void>;
}

/** 7 jours : au-delà, un appareil muet est de toute façon marqué hors ligne. */
const TTL_S = 7 * 24 * 3600;

export class MemoryStateStore implements StateStore {
  private readonly data = new Map<string, Record<string, StoredValue>>();

  async get(deviceId: string) {
    return this.data.get(deviceId) ?? {};
  }

  async getMany(deviceIds: string[]) {
    const out = new Map<string, Record<string, StoredValue>>();
    for (const id of deviceIds) out.set(id, this.data.get(id) ?? {});
    return out;
  }

  async set(deviceId: string, value: CapabilityValue, at = new Date()) {
    const entry: StoredValue = { value, updated_at: at.toISOString() };
    const current = this.data.get(deviceId) ?? {};
    current[value.type] = entry;
    this.data.set(deviceId, current);
    return entry;
  }

  async close() {}
}

export class RedisStateStore implements StateStore {
  constructor(private readonly redis: Redis) {}

  private key(deviceId: string) {
    return `device:${deviceId}:state`;
  }

  async get(deviceId: string) {
    const raw = await this.redis.hgetall(this.key(deviceId));
    return decode(raw);
  }

  async getMany(deviceIds: string[]) {
    if (deviceIds.length === 0) return new Map();
    const pipeline = this.redis.pipeline();
    for (const id of deviceIds) pipeline.hgetall(this.key(id));
    const results = await pipeline.exec();
    const out = new Map<string, Record<string, StoredValue>>();
    deviceIds.forEach((id, i) => {
      const raw = results?.[i]?.[1] as Record<string, string> | undefined;
      out.set(id, raw ? decode(raw) : {});
    });
    return out;
  }

  async set(deviceId: string, value: CapabilityValue, at = new Date()) {
    const entry: StoredValue = { value, updated_at: at.toISOString() };
    const key = this.key(deviceId);
    await this.redis
      .multi()
      .hset(key, value.type, JSON.stringify(entry))
      .expire(key, TTL_S)
      .exec();
    return entry;
  }

  async close() {
    await this.redis.quit();
  }
}

function decode(raw: Record<string, string>): Record<string, StoredValue> {
  const out: Record<string, StoredValue> = {};
  for (const [type, json] of Object.entries(raw)) {
    try {
      out[type] = JSON.parse(json) as StoredValue;
    } catch {
      // Entrée corrompue : ignorée plutôt que de faire tomber toute la lecture.
    }
  }
  return out;
}
