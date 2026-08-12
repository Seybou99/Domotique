import { useCallback, useEffect, useRef, useState } from 'react';
import * as TuyaPairing from '../../modules/tuya-pairing';
import { loadWifiCredentials, saveWifiCredentials } from './wifiCredentials';
import { useHome } from './HomeProvider';
import { useIntegrations, type ThirdPartyProviderName } from './hooks';

/**
 * Appairage Wi-Fi d'un appareil Tuya, depuis l'application.
 *
 * Enchaîne trois choses que l'écran n'a pas à connaître : récupérer le compte
 * technique auprès du serveur, ouvrir un foyer Tuya, puis lancer l'appairage.
 *
 * Ce qui **ne** passe **pas** par le SDK : le pilotage. Une fois l'appareil
 * appairé, il devient visible du projet cloud et c'est le backend qui le
 * commande. L'écran enchaîne donc sur l'import déjà existant.
 */
export type PairingState =
  | { step: 'idle' }
  | { step: 'preparing' }
  | { step: 'searching'; progress: 'connecting' | 'binding' }
  | { step: 'found'; device: TuyaPairing.FoundDevice }
  | { step: 'failed'; message: string };

const PROVIDER: ThirdPartyProviderName = 'tuya';

export function useTuyaPairing() {
  const { home } = useHome();
  const integrations = useIntegrations(home?.id);
  const [state, setState] = useState<PairingState>({ step: 'idle' });
  const subscriptions = useRef<{ remove: () => void }[]>([]);
  // Retenus le temps de l'appairage : ils ne sont enregistrés qu'une fois prouvés.
  const attempted = useRef<{ ssid: string; password: string } | null>(null);

  const cleanup = useCallback(() => {
    for (const subscription of subscriptions.current) subscription.remove();
    subscriptions.current = [];
    void TuyaPairing.stopPairing();
  }, []);

  // Toujours refermer la fenêtre en quittant l'écran : elle consomme la radio
  // et peut capter l'appareil d'un voisin.
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(
    async (ssid: string, password: string) => {
      if (!TuyaPairing.isAvailable) {
        setState({
          step: 'failed',
          message:
            'L’appairage Wi-Fi demande un build de développement. Dans Expo Go, passez par le compte connecté.',
        });
        return;
      }
      if (!home) return;

      cleanup();
      attempted.current = { ssid, password };
      setState({ step: 'preparing' });

      try {
        const credentials = await integrations.appCredentials.mutateAsync(PROVIDER);
        await TuyaPairing.signIn(credentials.uid, credentials.password, credentials.country_code);
        const { homeId } = await TuyaPairing.ensureHome(home.name);

        subscriptions.current = [
          TuyaPairing.onPairingProgress((progress) => {
            // `binding` signifie que l'appareil a rejoint le réseau : les
            // identifiants sont donc bons, quoi qu'il advienne de l'association
            // au compte ensuite. Attendre le succès complet ferait perdre un
            // réseau pourtant vérifié à chaque appairage qui échoue plus loin —
            // et ce sont justement ces cas-là qu'on rejoue le plus souvent.
            if (progress.step === 'binding' && attempted.current) {
              void saveWifiCredentials(attempted.current);
            }
            setState({ step: 'searching', progress: progress.step });
          }),
          TuyaPairing.onDeviceFound((device) => {
            // Le réseau n'est retenu qu'ici : un appareil qui répond prouve que
            // ces identifiants sont les bons. Les enregistrer au lancement
            // graverait une faute de frappe, et l'appairage suivant la rejouerait.
            if (attempted.current) void saveWifiCredentials(attempted.current);
            setState({ step: 'found', device });
          }),
          TuyaPairing.onPairingError((error) => setState({ step: 'failed', message: error.message })),
        ].filter((s): s is { remove: () => void } => s !== null);

        await TuyaPairing.startPairing({ ssid, password, homeId });
        setState({ step: 'searching', progress: 'connecting' });
      } catch (error) {
        setState({
          step: 'failed',
          message: error instanceof Error ? error.message : 'L’appairage a échoué.',
        });
      }
    },
    [home, integrations.appCredentials, cleanup],
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

  return {
    state,
    start,
    reset,
    detectSsid,
    rememberedNetwork,
    isAvailable: TuyaPairing.isAvailable,
  };
}
