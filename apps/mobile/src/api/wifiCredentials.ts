import * as SecureStore from 'expo-secure-store';

/**
 * Identifiants du réseau Wi-Fi du foyer, retenus entre deux appairages.
 *
 * **Pourquoi les conserver.** iOS ne communique jamais le mot de passe Wi-Fi à
 * une application : il vit dans le trousseau système, hors d'atteinte. Sans
 * mémorisation, chaque appareil ajouté impose de le ressaisir en entier — et on
 * ajoute rarement un seul appareil.
 *
 * **Où.** Dans le trousseau, comme les jetons de session, et non dans
 * `AsyncStorage` : ce dernier est un fichier en clair, lisible depuis une
 * sauvegarde ou un appareil débridé. C'est un mot de passe de réseau
 * domestique — le traiter comme un secret est la seule position tenable.
 *
 * **Jusqu'à quand.** Effacés à la déconnexion, avec les jetons : le téléphone
 * peut changer de main, et le compte suivant n'a pas à hériter du réseau du
 * précédent.
 */
const SSID_KEY = 'domotique.wifi_ssid';
const PASSWORD_KEY = 'domotique.wifi_password';

export type WifiCredentials = { ssid: string; password: string };

/**
 * Les deux valeurs, ou rien.
 *
 * Un couple incomplet ne préremplirait qu'un champ sur deux, ce qui donne à
 * croire que l'autre a été oublié plutôt que jamais enregistré.
 */
export async function loadWifiCredentials(): Promise<WifiCredentials | null> {
  try {
    const [ssid, password] = await Promise.all([
      SecureStore.getItemAsync(SSID_KEY),
      SecureStore.getItemAsync(PASSWORD_KEY),
    ]);
    if (!ssid || password === null) return null;
    return { ssid, password };
  } catch {
    // Trousseau indisponible : on préremplit simplement moins.
    return null;
  }
}

/** À n'appeler qu'après un appairage réussi : des identifiants faux ne servent personne. */
export async function saveWifiCredentials({ ssid, password }: WifiCredentials): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(SSID_KEY, ssid),
      SecureStore.setItemAsync(PASSWORD_KEY, password),
    ]);
  } catch {
    // L'échec de l'enregistrement ne doit pas faire échouer un appairage réussi.
  }
}

export async function forgetWifiCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SSID_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => {}),
  ]);
}
