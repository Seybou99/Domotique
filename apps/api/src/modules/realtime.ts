import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  WS_CLOSE,
  WS_PATH,
  clientMessage,
  type ServerEvent,
  type ServerMessage,
} from '@domotique/contract';
import type { Ctx } from '../context.js';

/**
 * Canal temps réel (CDC §5).
 *
 * Un canal par foyer, avec deux mécanismes que le CDC promettait sans en
 * spécifier le support :
 *
 *  - **reprise après coupure** : l'app renvoie son dernier `event_id` à
 *    l'abonnement. Si la fenêtre de rejeu le couvre encore, on lui livre le
 *    delta ; sinon on répond `resync_required` et elle repart de
 *    `GET /v1/homes/:id/state`. Renvoyer un delta vide laisserait l'app avec un
 *    état périmé sans qu'elle le sache — c'est le pire des cas.
 *  - **cycle de vie du jeton** : on prévient avant l'expiration plutôt que de
 *    couper. L'app renvoie un jeton frais sur la même socket.
 *
 * Rappel produit : iOS suspend les WebSocket en arrière-plan. Ce canal accélère
 * l'affichage au premier plan ; il ne remplace pas les notifications push.
 */

/** Délai de prévenance avant expiration du jeton. */
const EXPIRY_WARNING_S = 60;

/** Garde-fou anti-inondation : au-delà, la socket est fermée. */
const MAX_MESSAGES_PER_MINUTE = 120;

export function registerRealtime(app: FastifyInstance, ctx: Ctx) {
  app.get(WS_PATH, { websocket: true }, (socket, req) => {
    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    /** Abonnements vivants de cette connexion, par foyer. */
    const subscriptions = new Map<string, () => void>();
    let timers: NodeJS.Timeout[] = [];
    let messageCount = 0;
    let userId: string;

    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    };

    const cleanup = () => {
      clearTimers();
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    };

    /**
     * Le jeton est passé en paramètre de requête : l'API WebSocket standard ne
     * permet pas d'en-tête personnalisé côté navigateur, et son support en React
     * Native est inégal. Contrepartie assumée : les URL finissent dans les
     * journaux, d'où la rédaction configurée sur le logger (voir server.ts).
     */
    const token =
      (req.query as { access_token?: string })?.access_token ??
      req.headers.authorization?.replace(/^Bearer /, '');

    if (!token) {
      socket.close(WS_CLOSE.auth_invalid, 'jeton absent');
      return;
    }

    /** Programme la prévenance puis la fermeture, d'après l'expiration du jeton. */
    const scheduleExpiry = (accessToken: string) => {
      clearTimers();
      const claims = ctx.auth.verifyAccess(accessToken) as { exp?: number };
      if (!claims.exp) return;

      const msUntilExpiry = claims.exp * 1000 - Date.now();
      const warnIn = msUntilExpiry - EXPIRY_WARNING_S * 1000;

      if (warnIn > 0) {
        timers.push(
          setTimeout(() => {
            send({ kind: 'control', type: 'auth_expiring', expires_in_s: EXPIRY_WARNING_S });
          }, warnIn),
        );
      }
      timers.push(
        setTimeout(() => socket.close(WS_CLOSE.auth_expired, 'jeton expiré'), Math.max(0, msUntilExpiry)),
      );
    };

    try {
      userId = ctx.auth.verifyAccess(token).sub;
      scheduleExpiry(token);
    } catch {
      socket.close(WS_CLOSE.auth_invalid, 'jeton invalide');
      return;
    }

    // Remise à zéro du compteur toutes les minutes.
    const rateTimer = setInterval(() => {
      messageCount = 0;
    }, 60_000);
    rateTimer.unref?.();

    async function subscribe(homeId: string, lastEventId: string | null) {
      try {
        await ctx.access.requireHome(userId, homeId);
      } catch {
        socket.close(WS_CLOSE.forbidden, 'foyer inaccessible');
        return;
      }

      subscriptions.get(homeId)?.();

      /**
       * On s'abonne **avant** de rejouer, en mettant les événements vivants de
       * côté. L'ordre inverse laisserait passer entre les deux tout événement
       * survenu pendant la lecture du delta.
       */
      const buffered: ServerEvent[] = [];
      let flushing = true;
      const unsubscribe = ctx.events.subscribe(homeId, (event) => {
        if (flushing) buffered.push(event);
        else send(event);
      });
      subscriptions.set(homeId, unsubscribe);

      const delta = lastEventId ? await ctx.events.replay(homeId, lastEventId) : [];
      if (delta === null) {
        flushing = false;
        buffered.length = 0;
        send({ kind: 'control', type: 'resync_required', home_id: homeId, reason: 'window_expired' });
        return;
      }

      const seen = new Set<string>();
      for (const event of delta) {
        seen.add(event.event_id);
        send(event);
      }
      // Les doublons entre delta et tampon sont écartés par `event_id`.
      for (const event of buffered) if (!seen.has(event.event_id)) send(event);
      flushing = false;

      const eventId = await ctx.events.lastEventId(homeId);
      send({ kind: 'control', type: 'subscribed', home_id: homeId, event_id: eventId });
    }

    socket.on('message', (raw: Buffer) => {
      if (++messageCount > MAX_MESSAGES_PER_MINUTE) {
        socket.close(WS_CLOSE.rate_limited, 'trop de messages');
        return;
      }

      let parsed;
      try {
        parsed = clientMessage.safeParse(JSON.parse(raw.toString()));
      } catch {
        return; // JSON illisible : ignoré, jamais deviné
      }
      if (!parsed.success) return;
      const message = parsed.data;

      switch (message.type) {
        case 'subscribe':
          void subscribe(message.home_id, message.last_event_id);
          break;
        case 'unsubscribe':
          subscriptions.get(message.home_id)?.();
          subscriptions.delete(message.home_id);
          break;
        case 'auth_refresh':
          try {
            userId = ctx.auth.verifyAccess(message.access_token).sub;
            scheduleExpiry(message.access_token);
          } catch {
            socket.close(WS_CLOSE.auth_invalid, 'jeton de renouvellement invalide');
          }
          break;
        case 'ping':
          send({ kind: 'control', type: 'pong' });
          break;
      }
    });

    socket.on('close', () => {
      clearInterval(rateTimer);
      cleanup();
    });
    socket.on('error', () => {
      clearInterval(rateTimer);
      cleanup();
    });
  });
}

export type { WebSocket };
