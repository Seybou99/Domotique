import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { EventPayload } from '@domotique/contract';
import { createRealtimeClient } from './realtime';
import { keys, patchDeviceValue, type HomeState } from './hooks';
import { API_URL, useSession } from './session';

/**
 * Branchement du canal temps réel sur le cache de requêtes.
 *
 * Chaque événement met à jour le cache **en place** plutôt que d'invalider :
 * recharger tout l'état du foyer à chaque changement d'un capteur ferait une
 * requête par relevé, et ferait clignoter l'interface.
 *
 * iOS suspend les WebSocket en arrière-plan. Au retour au premier plan, on
 * recharge l'état complet : le canal se reconnectera et rejouera le delta, mais
 * l'utilisateur ne doit pas voir de données périmées pendant ce temps.
 */
/** Appareil détecté pendant une fenêtre d'association (écran 2.5). */
export type Discovered = {
  unitId: string;
  externalId: string;
  suggestedName: string;
  kind: string;
};

type RealtimeValue = {
  connected: boolean;
  enabled: boolean;
  /** Découvertes de la fenêtre d'association en cours. */
  discovered: Discovered[];
  /** Vidé à l'ouverture d'une nouvelle fenêtre. */
  clearDiscovered: () => void;
  pairingClosed: boolean;
};

const RealtimeContext = createContext<RealtimeValue>({
  connected: false,
  enabled: false,
  discovered: [],
  clearDiscovered: () => {},
  pairingClosed: false,
});

export function RealtimeProvider({
  homeId,
  children,
}: {
  homeId: string | undefined;
  children: React.ReactNode;
}) {
  const { getAccessToken, refreshAccessToken, status } = useSession();
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const [pairingClosed, setPairingClosed] = useState(false);

  useEffect(() => {
    if (!homeId || status !== 'signed-in') return;

    const apply = (event: EventPayload) => {
      switch (event.type) {
        case 'device_state_changed':
          patchDeviceValue(client, homeId, event.device_id, event.capability);
          break;

        case 'device_availability_changed':
          client.setQueryData<HomeState>(keys.homeState(homeId), (previous) =>
            previous
              ? {
                  ...previous,
                  devices: previous.devices.map((device) =>
                    device.id === event.device_id ? { ...device, online: event.online } : device,
                  ),
                }
              : previous,
          );
          break;

        case 'unit_availability_changed':
          client.setQueryData<HomeState>(keys.homeState(homeId), (previous) =>
            previous
              ? {
                  ...previous,
                  units: previous.units.map((unit) =>
                    unit.id === event.unit_id ? { ...unit, online: event.online } : unit,
                  ),
                }
              : previous,
          );
          break;

        // Ajout ou retrait d'appareil : la structure change, un rechargement
        // complet est plus sûr qu'une reconstruction partielle.
        case 'device_added':
        case 'device_removed':
          void client.invalidateQueries({ queryKey: keys.homeState(homeId) });
          break;

        case 'alert_created':
          void client.invalidateQueries({ queryKey: keys.alerts(homeId) });
          break;

        case 'automation_run_updated':
          void client.invalidateQueries({ queryKey: keys.automations(homeId) });
          break;

        // L'association Zigbee n'a pas d'endpoint de scrutation : les
        // découvertes arrivent uniquement par ce canal.
        case 'pairing_device_found':
          setDiscovered((previous) =>
            previous.some((d) => d.externalId === event.external_id)
              ? previous
              : [
                  ...previous,
                  {
                    unitId: event.unit_id,
                    externalId: event.external_id,
                    suggestedName: event.suggested_name,
                    kind: event.kind,
                  },
                ],
          );
          break;

        case 'pairing_closed':
          setPairingClosed(true);
          break;

        case 'command_updated':
        case 'integration_reauth_required':
          break;
      }
    };

    const realtime = createRealtimeClient(
      { baseUrl: API_URL, homeId, getAccessToken, refreshAccessToken },
      {
        onEvent: apply,
        onResyncRequired: () => {
          // La fenêtre de rejeu est dépassée : on repart d'un instantané complet.
          void client.invalidateQueries({ queryKey: keys.homeState(homeId) });
        },
        onConnectionChange: setConnected,
      },
    );
    realtime.connect();

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void client.invalidateQueries({ queryKey: keys.homeState(homeId) });
      }
    });

    return () => {
      subscription.remove();
      realtime.close();
    };
  }, [homeId, status, client, getAccessToken, refreshAccessToken]);

  const clearDiscovered = useCallback(() => {
    setDiscovered([]);
    setPairingClosed(false);
  }, []);

  const value = useMemo(
    () => ({
      connected,
      enabled: Boolean(homeId) && status === 'signed-in',
      discovered,
      clearDiscovered,
      pairingClosed,
    }),
    [connected, homeId, status, discovered, clearDiscovered, pairingClosed],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
