import type Redis from 'ioredis';
import type { EventPayload, ServerEvent } from '@domotique/contract';

/**
 * Bus d'événements du canal temps réel (CDC §5, §9).
 *
 * Point important : le CDC promet un rejeu par `last_event_id`, ce qu'un simple
 * Pub/Sub ne peut pas offrir — un message publié pendant que l'app est dans un
 * tunnel est perdu définitivement. L'implémentation Redis s'appuie donc sur un
 * **Stream par foyer** (`XADD` / `XRANGE`), plafonné en longueur : on obtient
 * l'identifiant croissant, la fenêtre de rejeu, et la diffusion entre instances.
 */

export type Subscriber = (event: ServerEvent) => void;

export interface EventBus {
  publish(homeId: string, payload: EventPayload, at?: Date): Promise<ServerEvent>;
  /** Événements postérieurs à `afterId`, ou `null` si la fenêtre est dépassée. */
  replay(homeId: string, afterId: string): Promise<ServerEvent[] | null>;
  /** Identifiant du dernier événement — point de reprise après un instantané. */
  lastEventId(homeId: string): Promise<string>;
  subscribe(homeId: string, subscriber: Subscriber): () => void;
  close(): Promise<void>;
}

/** Taille de la fenêtre de rejeu. Au-delà, l'app repart d'un instantané complet. */
const WINDOW = 1000;

export class MemoryEventBus implements EventBus {
  private readonly log = new Map<string, ServerEvent[]>();
  private readonly subs = new Map<string, Set<Subscriber>>();
  private seq = 0;

  async publish(homeId: string, payload: EventPayload, at = new Date()) {
    this.seq += 1;
    const event: ServerEvent = {
      kind: 'event',
      event_id: `${at.getTime()}-${this.seq}`,
      home_id: homeId,
      at: at.toISOString(),
      data: payload,
    };
    const log = this.log.get(homeId) ?? [];
    log.push(event);
    if (log.length > WINDOW) log.splice(0, log.length - WINDOW);
    this.log.set(homeId, log);
    for (const subscriber of this.subs.get(homeId) ?? []) subscriber(event);
    return event;
  }

  async replay(homeId: string, afterId: string) {
    const log = this.log.get(homeId) ?? [];
    const index = log.findIndex((e) => e.event_id === afterId);
    if (index === -1) return null; // hors fenêtre → resynchronisation complète
    return log.slice(index + 1);
  }

  async lastEventId(homeId: string) {
    const log = this.log.get(homeId) ?? [];
    return log.at(-1)?.event_id ?? '0-0';
  }

  subscribe(homeId: string, subscriber: Subscriber) {
    const set = this.subs.get(homeId) ?? new Set();
    set.add(subscriber);
    this.subs.set(homeId, set);
    return () => set.delete(subscriber);
  }

  async close() {}
}

export class RedisEventBus implements EventBus {
  private readonly subs = new Map<string, Set<Subscriber>>();

  /**
   * Deux connexions : une pour publier et lire les streams, une seconde dédiée à
   * l'abonnement — une connexion Redis en mode subscribe ne peut plus rien faire
   * d'autre.
   */
  constructor(
    private readonly redis: Redis,
    private readonly subscriber: Redis,
  ) {
    this.subscriber.on('message', (channel, message) => {
      const homeId = channel.slice('home:'.length);
      const set = this.subs.get(homeId);
      if (!set?.size) return;
      const event = JSON.parse(message) as ServerEvent;
      for (const fn of set) fn(event);
    });
  }

  private stream(homeId: string) {
    return `home:${homeId}:events`;
  }

  async publish(homeId: string, payload: EventPayload, at = new Date()) {
    const id = await this.redis.xadd(
      this.stream(homeId),
      'MAXLEN',
      '~',
      String(WINDOW),
      '*',
      'data',
      JSON.stringify(payload),
      'at',
      at.toISOString(),
    );
    const event: ServerEvent = {
      kind: 'event',
      event_id: id ?? `${at.getTime()}-0`,
      home_id: homeId,
      at: at.toISOString(),
      data: payload,
    };
    await this.redis.publish(`home:${homeId}`, JSON.stringify(event));
    return event;
  }

  async replay(homeId: string, afterId: string) {
    const entries = await this.redis.xrange(this.stream(homeId), afterId, '+');
    // `XRANGE` est inclusif : si l'identifiant demandé n'est plus le premier
    // renvoyé, il est sorti de la fenêtre et le delta est incomplet.
    if (entries.length === 0) return null;
    const first = entries[0];
    if (!first || first[0] !== afterId) return null;
    return entries.slice(1).map(([id, fields]) => toEvent(homeId, id, fields));
  }

  async lastEventId(homeId: string) {
    const entries = await this.redis.xrevrange(this.stream(homeId), '+', '-', 'COUNT', 1);
    return entries[0]?.[0] ?? '0-0';
  }

  subscribe(homeId: string, fn: Subscriber) {
    const set = this.subs.get(homeId) ?? new Set();
    if (set.size === 0) void this.subscriber.subscribe(`home:${homeId}`);
    set.add(fn);
    this.subs.set(homeId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) void this.subscriber.unsubscribe(`home:${homeId}`);
    };
  }

  async close() {
    await Promise.all([this.redis.quit(), this.subscriber.quit()]);
  }
}

function toEvent(homeId: string, id: string, fields: string[]): ServerEvent {
  const map = new Map<string, string>();
  for (let i = 0; i < fields.length; i += 2) map.set(fields[i]!, fields[i + 1]!);
  return {
    kind: 'event',
    event_id: id,
    home_id: homeId,
    at: map.get('at') ?? new Date().toISOString(),
    data: JSON.parse(map.get('data') ?? '{}') as EventPayload,
  };
}
