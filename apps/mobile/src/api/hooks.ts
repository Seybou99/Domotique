import { useCallback, useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  alerts as alertsApi,
  automations as automationsApi,
  devices as devicesApi,
  homes as homesApi,
  integrations as integrationsApi,
  rooms as roomsApi,
  units as unitsApi,
  type AutomationAction,
  type AutomationCondition,
  type AutomationTrigger,
  type DeviceKind,
  type Protocol,
  type RoomIcon,
  type SceneIcon,
  type CapabilityValue,
  type Device,
  type EndpointResponse,
  type WritableCapabilityValue,
} from '@domotique/contract';
import { useSession } from './session';

/**
 * Accès aux données.
 *
 * Une seule requête porte l'essentiel : `GET /homes/:id/state` renvoie foyer,
 * pièces, appareils et boîtiers en un appel. C'est aussi le point de reprise du
 * temps réel, ce qui évite d'avoir deux chemins de synchronisation à maintenir.
 */

export const keys = {
  homes: ['homes'] as const,
  homeState: (homeId: string) => ['home-state', homeId] as const,
  automations: (homeId: string) => ['automations', homeId] as const,
  alerts: (homeId: string) => ['alerts', homeId] as const,
  units: (homeId: string) => ['units', homeId] as const,
  history: (deviceId: string) => ['history', deviceId] as const,
  energy: (deviceId: string, bucket: string) => ['energy', deviceId, bucket] as const,
  integrations: (homeId: string) => ['integrations', homeId] as const,
};

/** Écosystèmes reliables par compte — Zigbee passe par un boîtier, pas par OAuth. */
export type ThirdPartyProviderName = Exclude<Protocol, 'zigbee'>;

export type HomeState = EndpointResponse<typeof homesApi.state>;

export function useHomes() {
  const { api, status } = useSession();
  return useQuery({
    queryKey: keys.homes,
    // Sans cette garde, la requête part pendant la restauration de session,
    // prend un 401, et React Query met l'erreur en cache sans jamais réessayer :
    // l'utilisateur se retrouve connecté devant un écran vide.
    enabled: status === 'signed-in',
    queryFn: () => api.call(homesApi.list),
    select: (data) => data.items,
  });
}

export function useHomeState(homeId: string | undefined) {
  const { api } = useSession();
  return useQuery({
    queryKey: keys.homeState(homeId ?? ''),
    enabled: Boolean(homeId),
    queryFn: () => api.call(homesApi.state, { params: { home_id: homeId! } }),
    // Le temps réel maintient ces données à jour ; on ne resonde pas en boucle.
    staleTime: 60_000,
  });
}

export function useAutomations(homeId: string | undefined) {
  const { api } = useSession();
  return useQuery({
    queryKey: keys.automations(homeId ?? ''),
    enabled: Boolean(homeId),
    queryFn: () => api.call(automationsApi.list, { params: { home_id: homeId! } }),
    select: (data) => data.items,
  });
}

export function useAlerts(homeId: string | undefined) {
  const { api } = useSession();
  return useQuery({
    queryKey: keys.alerts(homeId ?? ''),
    enabled: Boolean(homeId),
    queryFn: () => api.call(alertsApi.list, { params: { home_id: homeId! }, query: { limit: 50, unread_only: false } }),
  });
}

export function useUnits(homeId: string | undefined) {
  const { api } = useSession();
  return useQuery({
    queryKey: keys.units(homeId ?? ''),
    enabled: Boolean(homeId),
    queryFn: () => api.call(unitsApi.list, { params: { home_id: homeId! } }),
    select: (data) => data.items,
  });
}

export function useDeviceHistory(deviceId: string | undefined) {
  const { api } = useSession();
  return useQuery({
    queryKey: keys.history(deviceId ?? ''),
    enabled: Boolean(deviceId),
    queryFn: () => api.call(devicesApi.history, { params: { device_id: deviceId! }, query: { limit: 20 } }),
    select: (data) => data.items,
  });
}

/** Fenêtres proposées sur l'écran de détail — l'API n'agrège que par heure ou par jour. */
export type EnergyRange = '24h' | '7d';

/**
 * Consommation agrégée d'un appareil.
 *
 * Les bornes sont calculées à l'ouverture et **mémorisées pour la durée du
 * montage** : les recalculer à chaque rendu produirait un `queryKey` toujours
 * différent, donc une requête en boucle.
 *
 * `staleTime` d'une minute : la consommation d'une heure écoulée ne change plus,
 * et celle en cours ne bouge pas assez vite pour justifier de resonder.
 */
export function useDeviceEnergy(deviceId: string | undefined, range: EnergyRange) {
  const { api } = useSession();
  const window = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    if (range === '24h') from.setHours(from.getHours() - 24);
    else from.setDate(from.getDate() - 7);
    return { from: from.toISOString(), to: to.toISOString() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, deviceId]);

  return useQuery({
    queryKey: keys.energy(deviceId ?? '', range),
    enabled: Boolean(deviceId),
    queryFn: () =>
      api.call(devicesApi.energy, {
        params: { device_id: deviceId! },
        query: { bucket: range === '24h' ? 'hour' : 'day', from: window.from, to: window.to },
      }),
    staleTime: 60_000,
  });
}

/** Applique une valeur de capacité au cache, sans attendre le serveur. */
export function patchDeviceValue(
  client: QueryClient,
  homeId: string,
  deviceId: string,
  value: CapabilityValue,
) {
  client.setQueryData<HomeState>(keys.homeState(homeId), (previous) => {
    if (!previous) return previous;
    return {
      ...previous,
      devices: previous.devices.map((device) =>
        device.id !== deviceId
          ? device
          : {
              ...device,
              capabilities: device.capabilities.map((capability) =>
                capability.type !== value.type
                  ? capability
                  : { ...capability, value, updated_at: new Date().toISOString() },
              ),
            },
      ),
    };
  });
}

/**
 * Envoi d'une commande, en optimiste.
 *
 * Le design system §5 impose que « le changement visuel précède la confirmation
 * réseau ». On écrit donc la valeur dans le cache immédiatement, et on la
 * restaure si le serveur refuse. La confirmation réelle arrive plus tard par le
 * canal temps réel — c'est elle qui fait autorité.
 */
export function useSendCommand(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ deviceId, target }: { deviceId: string; target: WritableCapabilityValue }) =>
      api.call(devicesApi.sendCommand, {
        params: { device_id: deviceId },
        // UUID généré côté app : rejouer la requête après une perte réseau ne
        // déclenche pas une seconde commande.
        body: { command_id: randomUuid(), target },
      }),

    onMutate: ({ deviceId, target }) => {
      if (!homeId) return;
      const previous = client.getQueryData<HomeState>(keys.homeState(homeId));
      patchDeviceValue(client, homeId, deviceId, target);
      return { previous };
    },

    onError: (_error, _variables, context) => {
      // Retour à l'état connu : le design system §14 veut une erreur factuelle,
      // pas un contrôle qui reste sur une valeur qui n'a jamais été appliquée.
      if (homeId && context?.previous) {
        client.setQueryData(keys.homeState(homeId), context.previous);
      }
    },
  });

  const send = useCallback(
    (deviceId: string, target: WritableCapabilityValue) => mutation.mutate({ deviceId, target }),
    [mutation],
  );

  return { send, isPending: mutation.isPending, error: mutation.error };
}

export function useRunAutomation(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (automationId: string) =>
      api.call(automationsApi.run, {
        params: { automation_id: automationId },
        body: { run_id: randomUuid() },
      }),
    onSuccess: () => {
      if (homeId) void client.invalidateQueries({ queryKey: keys.automations(homeId) });
    },
  });
}

export function useToggleAutomation(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.call(automationsApi.update, { params: { automation_id: id }, body: { enabled } }),
    onSuccess: () => {
      if (homeId) void client.invalidateQueries({ queryKey: keys.automations(homeId) });
    },
  });
}

export function useMarkAlertsRead(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.call(alertsApi.markAllRead, { params: { home_id: homeId! } }),
    onSuccess: () => {
      if (homeId) void client.invalidateQueries({ queryKey: keys.alerts(homeId) });
    },
  });
}

/** Appareils d'une pièce, triés comme à l'écran. */
export function devicesInRoom(state: HomeState | undefined, roomId: string): Device[] {
  return (state?.devices ?? []).filter((device) => device.room_id === roomId);
}

/**
 * `crypto.randomUUID` n'existe pas dans Hermes. Version v4 conforme à partir de
 * `Math.random` : ces identifiants ne servent qu'à l'idempotence, pas à la
 * sécurité — leur imprévisibilité n'est pas un critère.
 */
export function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

// ───────────────────────────────────────────────────────────── Pièces (CRUD)

export function useRoomMutations(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();
  // Les compteurs de pièce et la liste d'appareils vivent dans le même
  // instantané : toute modification de pièce l'invalide.
  const refresh = () => {
    if (!homeId) return;
    void client.invalidateQueries({ queryKey: keys.homeState(homeId) });
  };

  const create = useMutation({
    mutationFn: (input: { name: string; icon: RoomIcon; device_ids: string[] }) =>
      api.call(roomsApi.create, { params: { home_id: homeId! }, body: input }),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; icon?: RoomIcon }) =>
      api.call(roomsApi.update, { params: { room_id: id }, body }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.call(roomsApi.remove, { params: { room_id: id } }),
    onSuccess: refresh,
  });

  return { create, update, remove };
}

/** Rattache ou détache un appareil d'une pièce (écrans 1.5 et 2.3). */
export function useDeviceMutations(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();
  const refresh = () => {
    if (!homeId) return;
    void client.invalidateQueries({ queryKey: keys.homeState(homeId) });
  };

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; room_id?: string | null; kind?: DeviceKind }) =>
      api.call(devicesApi.update, { params: { device_id: id }, body }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.call(devicesApi.remove, { params: { device_id: id } }),
    onSuccess: refresh,
  });

  return { update, remove };
}

// ────────────────────────────────────────────────────────── Scénarios (CRUD)

export type AutomationInput = {
  name: string;
  icon: SceneIcon;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
};

export function useAutomationMutations(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();
  const refresh = () => {
    if (!homeId) return;
    void client.invalidateQueries({ queryKey: keys.automations(homeId) });
  };

  const create = useMutation({
    mutationFn: (input: AutomationInput) =>
      api.call(automationsApi.create, { params: { home_id: homeId! }, body: input }),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<AutomationInput> & { id: string }) =>
      api.call(automationsApi.update, { params: { automation_id: id }, body }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.call(automationsApi.remove, { params: { automation_id: id } }),
    onSuccess: refresh,
  });

  return { create, update, remove };
}

// ──────────────────────────────────────────────────── Ajout d'appareil

/** Ouverture et fermeture de la fenêtre d'association Zigbee (écran 2.5). */
export function usePairing() {
  const { api } = useSession();

  const start = useMutation({
    mutationFn: ({ unitId, durationS = 60 }: { unitId: string; durationS?: number }) =>
      api.call(unitsApi.startPairing, {
        params: { unit_id: unitId },
        body: { duration_s: durationS },
      }),
  });

  const stop = useMutation({
    mutationFn: (unitId: string) => api.call(unitsApi.stopPairing, { params: { unit_id: unitId } }),
  });

  return { start, stop };
}

export function useIntegrations(homeId: string | undefined) {
  const { api } = useSession();
  const client = useQueryClient();

  const accounts = useQuery({
    queryKey: keys.integrations(homeId ?? ''),
    enabled: Boolean(homeId),
    queryFn: () => api.call(integrationsApi.list, { params: { home_id: homeId! } }),
    select: (data) => data.items,
  });

  /** Écosystèmes reliés hors application (Tuya) : on enregistre le rattachement. */
  const linkConsole = useMutation({
    mutationFn: (provider: ThirdPartyProviderName) =>
      api.call(integrationsApi.link, { params: { home_id: homeId!, provider }, body: {} }),
    onSuccess: () => {
      if (homeId) void client.invalidateQueries({ queryKey: keys.integrations(homeId) });
    },
  });

  /** Compte technique du SDK natif — émis et conservé par le serveur. */
  const appCredentials = useMutation({
    mutationFn: (provider: ThirdPartyProviderName) =>
      api.call(integrationsApi.appCredentials, { params: { provider } }),
  });

  const oauthUrl = useMutation({
    mutationFn: (provider: ThirdPartyProviderName) =>
      api.call(integrationsApi.oauthUrl, { params: { home_id: homeId!, provider } }),
  });

  const complete = useMutation({
    mutationFn: ({ provider, code, state }: { provider: ThirdPartyProviderName; code: string; state: string }) =>
      api.call(integrationsApi.oauthCallback, {
        params: { home_id: homeId!, provider },
        body: { code, state },
      }),
    onSuccess: () => {
      if (homeId) void client.invalidateQueries({ queryKey: keys.integrations(homeId) });
    },
  });

  const importDevices = useMutation({
    mutationFn: ({ accountId, externalIds }: { accountId: string; externalIds: string[] }) =>
      api.call(integrationsApi.importDevices, {
        params: { account_id: accountId },
        body: { external_ids: externalIds },
      }),
    onSuccess: () => {
      if (homeId) {
        void client.invalidateQueries({ queryKey: keys.homeState(homeId) });
        void client.invalidateQueries({ queryKey: keys.integrations(homeId) });
      }
    },
  });

  const unlink = useMutation({
    mutationFn: (accountId: string) =>
      api.call(integrationsApi.unlink, {
        params: { account_id: accountId },
        body: { devices: 'delete' },
      }),
    onSuccess: () => {
      if (homeId) {
        void client.invalidateQueries({ queryKey: keys.homeState(homeId) });
        void client.invalidateQueries({ queryKey: keys.integrations(homeId) });
      }
    },
  });

  return { accounts, linkConsole, appCredentials, oauthUrl, complete, importDevices, unlink };
}

export function useDiscoveredDevices(accountId: string | undefined) {
  const { api } = useSession();
  return useQuery({
    queryKey: ['discover', accountId ?? ''],
    enabled: Boolean(accountId),
    queryFn: () => api.call(integrationsApi.discover, { params: { account_id: accountId! } }),
    select: (data) => data.items,
  });
}
