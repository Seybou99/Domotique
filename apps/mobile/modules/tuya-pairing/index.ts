/**
 * Appairage Wi-Fi Tuya depuis l'application.
 *
 * **Périmètre volontairement réduit à l'appairage.** Le SDK sait aussi piloter
 * les appareils, et on ne s'en sert pas : si l'application commandait, un
 * scénario programmé à 23:30 ne partirait pas téléphone éteint, et un autre
 * membre du foyer ne pourrait pas piloter ce que ce téléphone a appairé. Une
 * fois l'appareil appairé, il devient visible du projet cloud et c'est le
 * backend qui le commande — avec le connecteur Tuya déjà en place.
 *
 * Ce module n'existe pas dans Expo Go : il faut un build de développement.
 * `isAvailable` permet à l'interface de le dire proprement plutôt que de planter.
 */
import { requireOptionalNativeModule, EventSubscription } from 'expo-modules-core';

export type FoundDevice = {
  /** Identifiant Tuya de l'appareil — celui que le backend retrouvera. */
  deviceId: string;
  name: string;
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
  /** Mode AP : l'appareil expose un point d'accès, le téléphone lui passe le Wi-Fi. */
  startPairing(ssid: string, password: string, homeId: number, timeoutS: number): Promise<void>;
  stopPairing(): Promise<void>;
  addListener(event: string, listener: (payload: never) => void): EventSubscription;
};

const native = requireOptionalNativeModule<TuyaPairingNativeModule>('TuyaPairingModule');

/** Faux dans Expo Go et sur le web : le module natif n'y est pas compilé. */
export const isAvailable = native !== null;

function requireNative(): TuyaPairingNativeModule {
  if (!native) {
    throw new Error(
      'L’appairage Wi-Fi nécessite un build de développement — il n’est pas disponible dans Expo Go.',
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

export function startPairing(options: {
  ssid: string;
  password: string;
  homeId: number;
  timeoutS?: number;
}) {
  return requireNative().startPairing(
    options.ssid,
    options.password,
    options.homeId,
    options.timeoutS ?? 120,
  );
}

export function stopPairing() {
  return native ? native.stopPairing() : Promise.resolve();
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
