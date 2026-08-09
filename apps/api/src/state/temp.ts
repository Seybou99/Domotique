import type Redis from 'ioredis';

/**
 * Valeurs éphémères à durée de vie courte.
 *
 * Utilisé pour l'état anti-CSRF du flux OAuth : une valeur à usage unique, de
 * quelques minutes, qui n'a rien à faire en base relationnelle.
 */
export interface TempStore {
  put(key: string, value: string, ttlS: number): Promise<void>;
  /** Lit **et** supprime : un état OAuth ne doit servir qu'une fois. */
  take(key: string): Promise<string | null>;
}

export class MemoryTempStore implements TempStore {
  private readonly data = new Map<string, { value: string; expiresAt: number }>();

  async put(key: string, value: string, ttlS: number) {
    this.data.set(key, { value, expiresAt: Date.now() + ttlS * 1000 });
  }

  async take(key: string) {
    const entry = this.data.get(key);
    this.data.delete(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.value;
  }
}

export class RedisTempStore implements TempStore {
  constructor(private readonly redis: Redis) {}

  async put(key: string, value: string, ttlS: number) {
    await this.redis.set(`tmp:${key}`, value, 'EX', ttlS);
  }

  async take(key: string) {
    // `GETDEL` est atomique : deux requêtes concurrentes ne peuvent pas
    // consommer le même état OAuth.
    return this.redis.getdel(`tmp:${key}`);
  }
}
