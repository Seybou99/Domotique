import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { useQueryClient } from '@tanstack/react-query';
import { auth as authApi, type User } from '@domotique/contract';
import { createApiClient, ApiException, type ApiClient } from './client';
import { forgetWifiCredentials } from './wifiCredentials';

/**
 * Session utilisateur.
 *
 * Les jetons vivent dans le trousseau de l'appareil (`expo-secure-store`), pas
 * dans `AsyncStorage` : ce dernier est un fichier en clair, lisible depuis une
 * sauvegarde ou un appareil rooté.
 *
 * Le renouvellement est **mutualisé** : si cinq requêtes prennent un 401 en même
 * temps, une seule rafraîchit et les autres attendent son résultat. Sans cela,
 * cinq rotations concurrentes s'invalideraient mutuellement — le backend révoque
 * l'ancien jeton à l'usage.
 */

const ACCESS_KEY = 'domotique.access_token';
const REFRESH_KEY = 'domotique.refresh_token';

type SessionState = {
  status: 'loading' | 'signed-out' | 'signed-in';
  user: User | null;
  api: ApiClient;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Jeton courant — utilisé par le canal temps réel. */
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);

  const accessToken = useRef<string | null>(null);
  const refreshToken = useRef<string | null>(null);
  /** Renouvellement en cours, partagé par tous les appelants. */
  const refreshing = useRef<Promise<string | null> | null>(null);

  const persist = useCallback(async (access: string | null, refresh: string | null) => {
    accessToken.current = access;
    refreshToken.current = refresh;
    if (access && refresh) {
      await SecureStore.setItemAsync(ACCESS_KEY, access);
      await SecureStore.setItemAsync(REFRESH_KEY, refresh);
    } else {
      await SecureStore.deleteItemAsync(ACCESS_KEY);
      await SecureStore.deleteItemAsync(REFRESH_KEY);
    }
  }, []);

  const signOut = useCallback(async () => {
    const token = refreshToken.current;
    await persist(null, null);
    setUser(null);
    setStatus('signed-out');
    // Les données d'un compte ne doivent jamais réapparaître sous un autre.
    queryClient.clear();
    // Y compris le réseau Wi-Fi retenu pour l'appairage : le téléphone peut
    // changer de main, et c'est un mot de passe.
    await forgetWifiCredentials();
    // Révocation côté serveur au mieux : si elle échoue, la session locale est
    // déjà effacée, ce qui est ce qui compte pour l'utilisateur.
    if (token) {
      await bare.call(authApi.logout, { body: { refresh_token: token } }).catch(() => {});
    }
  }, [persist, queryClient]);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (refreshing.current) return refreshing.current;
    const token = refreshToken.current;
    if (!token) return null;

    refreshing.current = (async () => {
      try {
        const { tokens } = await bare.call(authApi.refresh, { body: { refresh_token: token } });
        await persist(tokens.access_token, tokens.refresh_token);
        return tokens.access_token;
      } catch {
        await signOut();
        return null;
      } finally {
        refreshing.current = null;
      }
    })();

    return refreshing.current;
  }, [persist, signOut]);

  /** Client sans renouvellement — sert aux appels d'authentification eux-mêmes. */
  const bare = useMemo(
    () => createApiClient({ baseUrl: API_URL, getAccessToken: () => accessToken.current }),
    [],
  );

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_URL,
        getAccessToken: () => accessToken.current,
        onUnauthorized: refreshAccessToken,
      }),
    [refreshAccessToken],
  );

  // Restauration de la session au démarrage.
  useEffect(() => {
    void (async () => {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      accessToken.current = access;
      refreshToken.current = refresh;

      if (!access || !refresh) {
        setStatus('signed-out');
        return;
      }
      try {
        const { user: me } = await api.call(authApi.me);
        setUser(me);
        setStatus('signed-in');
      } catch {
        await persist(null, null);
        setStatus('signed-out');
      }
    })();
  }, [api, persist]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user: me, tokens } = await bare.call(authApi.login, { body: { email, password } });
      await persist(tokens.access_token, tokens.refresh_token);
      queryClient.clear();
      setUser(me);
      setStatus('signed-in');
    },
    [bare, persist, queryClient],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { user: me, tokens } = await bare.call(authApi.signup, {
        body: { email, password, display_name: displayName },
      });
      await persist(tokens.access_token, tokens.refresh_token);
      queryClient.clear();
      setUser(me);
      setStatus('signed-in');
    },
    [bare, persist, queryClient],
  );

  const value = useMemo<SessionState>(
    () => ({
      status,
      user,
      api,
      signIn,
      signUp,
      signOut,
      getAccessToken: () => accessToken.current,
      refreshAccessToken,
    }),
    [status, user, api, signIn, signUp, signOut, refreshAccessToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession doit être utilisé dans un SessionProvider');
  return context;
}

/** Port du serveur d'API en développement — celui de `apps/api`. */
const DEV_API_PORT = 3000;

/**
 * Adresse du serveur.
 *
 * En développement, elle est **déduite de celle de Metro**. Le paquet JavaScript
 * vient forcément de la machine qui fait tourner l'API, et `hostUri` en porte
 * l'adresse telle que l'appareil la voit — la bonne pour un simulateur comme
 * pour un téléphone. Une adresse écrite à la main, elle, est fausse dès le
 * changement de réseau : l'IP d'un portable n'est stable ni dans le temps, ni
 * d'un lieu à l'autre, et l'application affiche alors « serveur injoignable »
 * sans que rien n'ait bougé dans le code.
 *
 * `EXPO_PUBLIC_API_URL` reste prioritaire quand elle est définie : c'est ce qui
 * permet de viser un serveur distant, et c'est la seule source en production, où
 * Metro n'existe pas.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  const metroHost = metroHostname();
  if (metroHost) return `http://${metroHost}:${DEV_API_PORT}`;

  // Dernier recours, juste sur simulateur : un téléphone qui appelle `localhost`
  // s'appelle lui-même. Faute de mieux, l'écran affichera « serveur injoignable ».
  return `http://localhost:${DEV_API_PORT}`;
}

/**
 * Hôte du serveur Metro, quelle que soit la façon dont l'application a été lancée.
 *
 * Trois sources, parce qu'aucune n'est présente dans tous les cas : le manifeste
 * moderne d'un build de développement (`manifest2`), la configuration classique
 * (`expoConfig`), et l'hôte de débogage d'Expo Go. Ne lire que la deuxième
 * suffisait au simulateur et laissait un téléphone physique sans adresse.
 *
 * `debuggerHost` et `hostUri` portent « hôte:port » ; le port est celui de Metro,
 * on ne garde que l'hôte. Une valeur locale est écartée : sur un téléphone, elle
 * désignerait le téléphone.
 */
function metroHostname(): string | null {
  const candidates = [
    (Constants.manifest2 as { extra?: { expoClient?: { hostUri?: string } } } | null)?.extra
      ?.expoClient?.hostUri,
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
  ];

  for (const candidate of candidates) {
    const host = candidate?.split(':')[0]?.trim();
    if (host && host !== 'localhost' && host !== '127.0.0.1') return host;
  }
  return null;
}

export const API_URL = resolveApiUrl();

export { ApiException };
