import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { auth as authApi, type User } from '@domotique/contract';
import { createApiClient, ApiException, type ApiClient } from './client';

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

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export { ApiException };
