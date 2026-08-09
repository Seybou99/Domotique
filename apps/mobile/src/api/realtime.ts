import {
  WS_CLOSE,
  WS_PATH,
  clientMessage,
  serverMessage,
  type ClientMessage,
  type EventPayload,
  type ResyncReason,
} from '@domotique/contract';

/**
 * Client temps réel.
 *
 * Implémente les deux mécanismes du CDC §5 que le document laissait sans support :
 *  - reprise après coupure : on conserve le dernier `event_id` reçu et on le
 *    renvoie au réabonnement ; si le serveur répond `resync_required`, on remonte
 *    l'information pour que l'appelant recharge `GET /v1/homes/:id/state` ;
 *  - cycle de vie du JWT : sur `auth_expiring`, on renvoie un token frais sans
 *    couper la socket ; sur fermeture 4001, on renouvelle puis on reconnecte.
 *
 * Rappel produit : iOS suspend les WebSocket en arrière-plan. Ce canal accélère
 * l'affichage au premier plan, il ne remplace pas les notifications push.
 */

export type RealtimeHandlers = {
  onEvent: (event: EventPayload) => void;
  /** L'app doit recharger l'instantané complet du foyer. */
  onResyncRequired: (reason: ResyncReason) => void;
  onConnectionChange?: (connected: boolean) => void;
};

export type RealtimeConfig = {
  /** Racine du backend en http(s) — convertie en ws(s) ici. */
  baseUrl: string;
  homeId: string;
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
};

const MAX_BACKOFF_MS = 30_000;

export function createRealtimeClient(config: RealtimeConfig, handlers: RealtimeHandlers) {
  let socket: WebSocket | null = null;
  let lastEventId: string | null = null;
  let attempt = 0;
  let closedByUs = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const wsUrl = () => {
    const base = config.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    const token = config.getAccessToken();
    return `${base}${WS_PATH}?access_token=${encodeURIComponent(token ?? '')}`;
  };

  const send = (message: ClientMessage) => {
    if (socket?.readyState !== 1) return;
    socket.send(JSON.stringify(clientMessage.parse(message)));
  };

  const scheduleReconnect = () => {
    if (closedByUs) return;
    // Exponentiel plafonné, avec gigue : évite que toute la flotte d'apps
    // reconnecte à la même seconde après un redéploiement du backend.
    const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS) * (0.7 + Math.random() * 0.6);
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  function connect() {
    closedByUs = false;
    socket = new WebSocket(wsUrl());

    socket.onopen = () => {
      attempt = 0;
      handlers.onConnectionChange?.(true);
      send({ type: 'subscribe', home_id: config.homeId, last_event_id: lastEventId });
    };

    socket.onmessage = (raw) => {
      const parsed = serverMessage.safeParse(JSON.parse(String(raw.data)));
      if (!parsed.success) return; // message hors contrat : ignoré, jamais deviné
      const message = parsed.data;

      if (message.kind === 'event') {
        lastEventId = message.event_id;
        handlers.onEvent(message.data);
        return;
      }

      switch (message.type) {
        case 'subscribed':
          lastEventId = message.event_id;
          break;
        case 'resync_required':
          lastEventId = null;
          handlers.onResyncRequired(message.reason);
          break;
        case 'auth_expiring':
          void config.refreshAccessToken().then((token) => {
            if (token) send({ type: 'auth_refresh', access_token: token });
          });
          break;
        case 'pong':
          break;
      }
    };

    socket.onclose = (event) => {
      handlers.onConnectionChange?.(false);
      if (event.code === WS_CLOSE.auth_expired || event.code === WS_CLOSE.auth_invalid) {
        void config.refreshAccessToken().then(scheduleReconnect);
        return;
      }
      if (event.code === WS_CLOSE.forbidden) return; // plus de droits sur ce foyer
      scheduleReconnect();
    };

    socket.onerror = () => socket?.close();
  }

  return {
    connect,
    /** Point de reprise courant — utile pour se réabonner après un instantané. */
    get lastEventId() {
      return lastEventId;
    },
    /** À appeler après un rechargement de `GET /v1/homes/:id/state`. */
    resumeFrom(eventId: string) {
      lastEventId = eventId;
      send({ type: 'subscribe', home_id: config.homeId, last_event_id: eventId });
    },
    close() {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
    },
  };
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>;
