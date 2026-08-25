import { useCallback, useEffect, useRef, useState } from 'react';
import * as TuyaPairing from '../../modules/tuya-pairing';
import { useHome } from './HomeProvider';
import { useIntegrations, type ThirdPartyProviderName } from './hooks';
import { loadWifiCredentials, saveWifiCredentials } from './wifiCredentials';

/**
 * Appairage d'un appareil connecté, depuis l'application.
 *
 * Deux temps, parce que le matériel l'impose : on **écoute** d'abord les
 * appareils qui s'annoncent en Bluetooth, puis on **transmet** le Wi-Fi à celui
 * que l'utilisateur a choisi. Demander le réseau avant de savoir quel appareil
 * répond obligerait à le saisir à l'aveugle, sans même savoir s'il y a quelqu'un
 * en face.
 *
 * Ce qui **ne** passe **pas** par le SDK : le pilotage. Une fois l'appareil
 * appairé, il devient visible du projet cloud et c'est le backend qui le
 * commande. L'écran enchaîne donc sur l'import déjà existant.
 */
export type PairingState =
  | { step: 'idle' }
  | { step: 'scanning'; devices: TuyaPairing.DiscoveredDevice[] }
  | { step: 'preparing' }
  | { step: 'pairing'; progress: 'connecting' | 'binding' }
  | { step: 'found'; device: TuyaPairing.FoundDevice }
  | { step: 'failed'; message: string };

const PROVIDER: ThirdPartyProviderName = 'tuya';

/**
 * Un peu plus que le délai laissé au SDK (120 s) : on ne veut couper que s'il
 * n'a lui-même rien conclu, jamais avant.
 */
const PAIRING_TIMEOUT_MS = 135_000;

/** Cadence de vérification du foyer, et nombre d'essais avant d'abandonner. */
const HOME_POLL_INTERVAL_MS = 5_000;
const HOME_POLL_ATTEMPTS = 24;

/**
 * Tolérance sur l'écart entre l'horloge du téléphone et celle du serveur Tuya.
 *
 * La date d'activation vient du serveur, l'instant de référence du téléphone.
 * Quelques secondes de décalage suffiraient à faire manquer l'appareil, et ce
 * rendez-vous manqué se lirait comme un échec d'appairage.
 */
const PAIRING_CLOCK_SLACK_S = 60;

export function useTuyaPairing() {
  const { home } = useHome();
  const integrations = useIntegrations(home?.id);
  const [state, setState] = useState<PairingState>({ step: 'idle' });
  const subscriptions = useRef<{ remove: () => void }[]>([]);
  // Retenus le temps de l'appairage : ils ne sont enregistrés qu'une fois prouvés.
  const attempted = useRef<{ ssid: string; password: string } | null>(null);
  /// Coupe la surveillance du foyer dès que l'écran conclut, par succès ou par abandon.
  const watching = useRef(false);

  /**
   * Les rappels du SDK, dans le terminal de développement.
   *
   * Branché pour toute la durée de l'écran, et pas seulement pendant
   * l'appairage : les messages les plus utiles arrivent justement quand rien ne
   * se passe.
   */
  useEffect(() => {
    const subscription = TuyaPairing.onTrace(({ message }) => {
      console.log('[Tuya]', message);
    });
    return () => subscription?.remove();
  }, []);

  const cleanup = useCallback(() => {
    watching.current = false;
    for (const subscription of subscriptions.current) subscription.remove();
    subscriptions.current = [];
    void TuyaPairing.stopPairing();
  }, []);

  // Toujours refermer en quittant l'écran : l'écoute consomme la radio et la
  // batterie, et peut capter l'appareil d'un voisin.
  useEffect(() => cleanup, [cleanup]);

  /**
   * Garde-fou sur la durée de l'appairage.
   *
   * Le SDK reçoit bien un délai, mais son rappel d'échec ne se déclenche pas
   * toujours : quand l'appareil rejoint le réseau sans que le cloud confirme,
   * rien ne revient — ni succès, ni erreur. Sans cette sortie, l'écran reste
   * « en cours » pour toujours, ce qui ne laisse à l'utilisateur que le retour
   * arrière et aucune explication.
   */
  useEffect(() => {
    if (state.step !== 'pairing') return;
    const timer = setTimeout(() => {
      setState({
        step: 'failed',
        message:
          'L’appareil a rejoint le réseau, mais ne s’est pas associé à votre compte dans le temps imparti. Il est peut-être déjà appairé ailleurs, ou le service du fabricant ne répond pas.',
      });
      void TuyaPairing.stopPairing();
    }, PAIRING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.step]);

  /**
   * Écoute les appareils à proximité.
   *
   * Les découvertes s'accumulent dans l'état : elles arrivent une par une, au
   * rythme des annonces, et rien ne dit qu'il n'en viendra pas d'autres.
   */
  const scan = useCallback(async () => {
    if (!TuyaPairing.isAvailable) {
      setState({
        step: 'failed',
        message:
          'L’appairage demande un build de développement. Dans Expo Go, passez par le compte connecté.',
      });
      return;
    }

    cleanup();
    setState({ step: 'scanning', devices: [] });

    const subscription = TuyaPairing.onDeviceDiscovered((device) => {
      setState((current) => {
        if (current.step !== 'scanning') return current;
        // Le module natif filtre déjà les doublons, mais une reprise d'écoute
        // remet son cache à zéro : on se protège des deux côtés.
        if (current.devices.some((d) => d.uuid === device.uuid)) return current;
        return { step: 'scanning', devices: [...current.devices, device] };
      });
    });
    if (subscription) subscriptions.current.push(subscription);

    try {
      await TuyaPairing.startScan();
    } catch (error) {
      setState({
        step: 'failed',
        message: error instanceof Error ? error.message : 'La recherche a échoué.',
      });
    }
  }, [cleanup]);

  /**
   * Transmet le réseau à l'appareil choisi.
   *
   * Le compte technique et le foyer Tuya sont obtenus **avant** de lancer
   * l'appairage : une fois la liaison Bluetooth engagée, l'appareil monopolise
   * l'attention et une requête réseau qui traîne ferait expirer la fenêtre.
   */
  /**
   * Surveille l'arrivée de l'appareil dans le foyer Tuya.
   *
   * Le SDK annonce parfois l'appairage, parfois pas : l'appareil bascule sur le
   * Wi-Fi, refuse alors les connexions Bluetooth, et le SDK conclut à tort à un
   * échec après trois tentatives de reconnexion. Le foyer, lui, contient déjà le
   * nouvel appareil. On interroge donc le serveur plutôt que d'attendre un
   * rappel dont on sait qu'il peut ne jamais venir.
   *
   * L'arrêt est piloté par la référence : le succès du SDK, s'il arrive, fait
   * passer l'état à `found` et cette boucle s'interrompt d'elle-même.
   */
  const watchHome = useCallback((homeId: number, startedAt: number) => {
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      if (attempts > HOME_POLL_ATTEMPTS || !watching.current) return;

      const devices = await TuyaPairing.homeDevices(homeId);
      // Activé depuis le lancement de la tentative : c'est ce qui distingue
      // l'appareil qu'on vient d'appairer de ceux déjà présents. Chercher un
      // identifiant inconnu ne marchait que pour un tout premier appairage.
      const added = devices.find(
        (device) => (device.activeTime ?? 0) >= startedAt - PAIRING_CLOCK_SLACK_S,
      );
      if (added && watching.current) {
        watching.current = false;
        if (attempted.current) void saveWifiCredentials(attempted.current);
        setState({ step: 'found', device: added });
        void TuyaPairing.stopPairing();
        return;
      }
      setTimeout(() => void tick(), HOME_POLL_INTERVAL_MS);
    };

    watching.current = true;
    setTimeout(() => void tick(), HOME_POLL_INTERVAL_MS);
  }, []);

  const pair = useCallback(
    async (device: TuyaPairing.DiscoveredDevice, ssid: string, password: string) => {
      if (!home) return;

      setState({ step: 'preparing' });
      attempted.current = { ssid, password };

      try {
        void TuyaPairing.stopScan();

        const credentials = await integrations.appCredentials.mutateAsync(PROVIDER);
        const account = await TuyaPairing.signIn(
          credentials.uid,
          credentials.password,
          credentials.country_code,
        );

        // L'identifiant que le fournisseur attribue au compte, remonté au
        // serveur : c'est le seul avec lequel il pourra lister les appareils.
        // Un échec ici ne doit pas empêcher l'appairage — il se rattrapera à la
        // tentative suivante, et l'import dira ce qui manque.
        void integrations.reportSdkAccount
          .mutateAsync({ provider: PROVIDER, remoteUid: account.uid })
          .catch(() => {});

        const { homeId } = await TuyaPairing.ensureHome(home.name);

        subscriptions.current.push(
          ...[
            TuyaPairing.onPairingProgress((progress) => {
              // `binding` signifie que l'appareil a rejoint le réseau : les
              // identifiants sont donc bons, quoi qu'il advienne de l'association
              // au compte ensuite. Attendre le succès complet ferait perdre un
              // réseau pourtant vérifié à chaque appairage qui échoue plus loin —
              // et ce sont justement ces cas-là qu'on rejoue le plus souvent.
              if (progress.step === 'binding' && attempted.current) {
                void saveWifiCredentials(attempted.current);
              }
              setState({ step: 'pairing', progress: progress.step });
            }),
            TuyaPairing.onDeviceFound((found) => {
              watching.current = false;
              if (attempted.current) void saveWifiCredentials(attempted.current);
              setState({ step: 'found', device: found });
            }),
            TuyaPairing.onPairingError((error) =>
              setState({ step: 'failed', message: error.message }),
            ),
          ].filter((s): s is { remove: () => void } => s !== null),
        );

        // Instant de référence : l'appareil appairé sera celui dont la date
        // d'activation lui est postérieure.
        const startedAt = Math.floor(Date.now() / 1000);

        await TuyaPairing.pairDevice({
          uuid: device.uuid,
          productId: device.productId,
          ssid,
          password,
          homeId,
        });
        setState({ step: 'pairing', progress: 'connecting' });
        watchHome(homeId, startedAt);
      } catch (error) {
        setState({
          step: 'failed',
          message: error instanceof Error ? error.message : 'L’appairage a échoué.',
        });
      }
    },
    [home, integrations.appCredentials],
  );

  const reset = useCallback(() => {
    cleanup();
    setState({ step: 'idle' });
  }, [cleanup]);

  /**
   * Nom du réseau courant, pour préremplir la saisie — `null` s'il est illisible.
   *
   * Le système peut le refuser de plusieurs façons (autorisation, entitlement,
   * données mobiles) et l'écran les traite toutes pareil : il laisse saisir.
   */
  const detectSsid = useCallback(() => TuyaPairing.currentSsid(), []);

  /** Réseau retenu lors d'un appairage précédent — `null` au tout premier. */
  const rememberedNetwork = useCallback(() => loadWifiCredentials(), []);

  /** Réseaux que l'appareil capte lui-même — liste vide s'il ne sait pas répondre. */
  const networksNearDevice = useCallback((uuid: string) => TuyaPairing.queryWifiList(uuid), []);

  return {
    state,
    scan,
    pair,
    reset,
    detectSsid,
    rememberedNetwork,
    networksNearDevice,
    isAvailable: TuyaPairing.isAvailable,
  };
}
