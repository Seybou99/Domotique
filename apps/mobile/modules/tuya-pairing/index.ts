/**
 * Appairage d'un appareil connecté, depuis l'application.
 *
 * **Périmètre volontairement réduit à l'appairage.** Le SDK sait aussi piloter
 * les appareils, et on ne s'en sert pas : si l'application commandait, un
 * scénario programmé à 23:30 ne partirait pas téléphone éteint, et un autre
 * membre du foyer ne pourrait pas piloter ce que ce téléphone a appairé. Une
 * fois l'appareil appairé, il devient visible du projet cloud et c'est le
 * backend qui le commande — avec le connecteur Tuya déjà en place.
 *
 * **Bluetooth d'abord.** Les appareils récents annoncent leur présence tant
 * qu'ils ne sont pas appairés : on les découvre avant toute saisie, puis on leur
 * transmet le Wi-Fi par ce même canal. C'est ce que fait l'application du
 * fabricant, et ce que le matériel attend.
 *
 * Ce module n'existe pas dans Expo Go : il faut un build de développement.
 * `isAvailable` permet à l'interface de le dire proprement plutôt que de planter.
 */
import { requireOptionalNativeModule, EventSubscription } from 'expo-modules-core';

/** Appareil repéré par son annonce Bluetooth, pas encore appairé. */
export type DiscoveredDevice = {
  uuid: string;
  productId: string;
  mac: string;
  /** Faux pour la plupart des prises : elles ne captent que le 2,4 GHz. */
  supports5G: boolean;
};

export type FoundDevice = {
  /** Identifiant Tuya de l'appareil — celui que le backend retrouvera. */
  deviceId: string;
  name: string;
  /**
   * Date d'activation, en secondes.
   *
   * Absente des événements du SDK, présente dans la liste du foyer : c'est elle
   * qui identifie l'appareil tout juste appairé, y compris lorsqu'il figurait
   * déjà dans le foyer — un réappairage ne crée pas d'entrée, il en rafraîchit
   * une.
   */
  activeTime?: number;
};

export type PairingProgress = {
  /** `connecting` puis `binding` : l'appareil rejoint le Wi-Fi, puis le compte. */
  step: 'connecting' | 'binding';
};

type TuyaPairingNativeModule = {
  /** Nom du réseau Wi-Fi courant, ou `null` s'il est illisible. Ne rejette jamais. */
  currentSsid(): Promise<string | null>;
  /** Ouvre ou crée le compte Tuya technique de cet utilisateur. */
  signIn(countryCode: string, uid: string, password: string): Promise<{ uid: string }>;
  /** Foyer Tuya rattaché au compte — le SDK exige un `homeId` pour appairer. */
  ensureHome(name: string): Promise<{ homeId: number }>;
  /** Écoute les annonces Bluetooth des appareils non appairés. */
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  /** Réseaux que l'appareil capte — tous les modèles ne savent pas répondre. */
  queryWifiList(uuid: string): Promise<string[]>;
  /** Transmet le Wi-Fi à l'appareil par Bluetooth. */
  pairDevice(
    uuid: string,
    productId: string,
    ssid: string,
    password: string,
    homeId: number,
    timeoutS: number,
  ): Promise<void>;
  /** Appareils rattachés au foyer Tuya — le recours quand le rappel n'arrive pas. */
  homeDevices(homeId: number): Promise<FoundDevice[]>;
  stopPairing(): Promise<void>;
  addListener(event: string, listener: (payload: never) => void): EventSubscription;
};

const native = requireOptionalNativeModule<TuyaPairingNativeModule>('TuyaPairingModule');

/** Faux dans Expo Go et sur le web : le module natif n'y est pas compilé. */
export const isAvailable = native !== null;

function requireNative(): TuyaPairingNativeModule {
  if (!native) {
    throw new Error(
      'L’appairage nécessite un build de développement — il n’est pas disponible dans Expo Go.',
    );
  }
  return native;
}

/**
 * Nom du réseau Wi-Fi courant, pour préremplir la saisie.
 *
 * `null` couvre tous les cas où le système ne le donne pas : autorisation
 * refusée, entitlement absent du profil de signature, téléphone en données
 * mobiles, ou module absent. L'appelant traite ces cas de la même façon —
 * l'utilisateur saisit le nom lui-même — d'où une valeur plutôt qu'une erreur.
 */
export function currentSsid(): Promise<string | null> {
  // On vérifie la fonction, pas seulement le module : en développement, Metro
  // recharge le JavaScript sans recompiler le binaire. Une fonction native
  // ajoutée depuis le dernier build est absente de l'objet, et l'appeler lève
  // une `TypeError` synchrone — que le `catch` d'une promesse ne rattraperait pas.
  if (typeof native?.currentSsid !== 'function') return Promise.resolve(null);
  try {
    return native.currentSsid().catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

export function signIn(uid: string, password: string, countryCode = '33') {
  return requireNative().signIn(countryCode, uid, password);
}

export function ensureHome(name: string) {
  return requireNative().ensureHome(name);
}

export function startScan() {
  return requireNative().startScan();
}

export function stopScan() {
  return native ? native.stopScan().catch(() => {}) : Promise.resolve();
}

/**
 * Réseaux que l'appareil capte, ou liste vide s'il ne sait pas répondre.
 *
 * L'échec n'est pas remonté : il signifie seulement qu'il faudra saisir le nom
 * du réseau à la main, ce que l'écran sait déjà faire.
 */
export function queryWifiList(uuid: string): Promise<string[]> {
  if (typeof native?.queryWifiList !== 'function') return Promise.resolve([]);
  try {
    return native.queryWifiList(uuid).catch(() => []);
  } catch {
    return Promise.resolve([]);
  }
}

export function pairDevice(options: {
  uuid: string;
  productId: string;
  ssid: string;
  password: string;
  homeId: number;
  timeoutS?: number;
}) {
  return requireNative().pairDevice(
    options.uuid,
    options.productId,
    options.ssid,
    options.password,
    options.homeId,
    options.timeoutS ?? 120,
  );
}

/**
 * Appareils actuellement dans le foyer Tuya.
 *
 * Sert à constater un appairage que le SDK n'annonce pas : une fois passé sur le
 * Wi-Fi, l'appareil refuse les connexions Bluetooth, le SDK s'obstine à s'y
 * reconnecter, échoue, et ne rappelle jamais — alors que l'appareil est bel et
 * bien enregistré. Ce que le serveur possède fait foi.
 */
export function homeDevices(homeId: number): Promise<FoundDevice[]> {
  if (typeof native?.homeDevices !== 'function') return Promise.resolve([]);
  try {
    return native.homeDevices(homeId).catch(() => []);
  } catch {
    return Promise.resolve([]);
  }
}

export function stopPairing() {
  return native ? native.stopPairing() : Promise.resolve();
}

export function onDeviceDiscovered(
  listener: (device: DiscoveredDevice) => void,
): EventSubscription | null {
  return native ? native.addListener('onDeviceDiscovered', listener as never) : null;
}

export function onDeviceFound(listener: (device: FoundDevice) => void): EventSubscription | null {
  return native ? native.addListener('onDeviceFound', listener as never) : null;
}

export function onPairingError(
  listener: (error: { message: string }) => void,
): EventSubscription | null {
  return native ? native.addListener('onPairingError', listener as never) : null;
}

export function onPairingProgress(
  listener: (progress: PairingProgress) => void,
): EventSubscription | null {
  return native ? native.addListener('onPairingProgress', listener as never) : null;
}

/**
 * Trace des rappels du SDK, pour le terminal de développement.
 *
 * Le SDK échoue volontiers sans rien dire : distinguer « l'appareil n'écoutait
 * plus » de « le service a refusé » demande de voir ce qu'il rappelle, et il ne
 * le rapporte nulle part ailleurs.
 */
export function onTrace(listener: (event: { message: string }) => void): EventSubscription | null {
  if (typeof native?.addListener !== 'function') return null;
  try {
    return native.addListener('onTrace', listener as never);
  } catch {
    return null;
  }
}
