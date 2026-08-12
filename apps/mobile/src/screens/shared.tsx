import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { Card, ErrorState, SkeletonCard, Txt } from '../components';
import { useTheme } from '../theme/ThemeProvider';
import { iconStroke, space } from '../theme/tokens';
import { API_URL, ApiException, useSession } from '../api/session';
import { useRealtime } from '../api/RealtimeProvider';

/**
 * Coquille commune aux écrans d'onglet : zone sûre, défilement, tiré-pour-rafraîchir,
 * et les trois états systémiques du doc §14 (chargement, erreur, hors ligne).
 *
 * Les regrouper ici évite que chaque écran réinvente son squelette — et que l'un
 * d'eux oublie l'état d'erreur.
 */
/**
 * La garde d'authentification est ici, et pas seulement dans le groupe
 * d'onglets : un lien profond vers `/room-form` ou `/device-add` contourne ce
 * groupe. Sans garde, ces écrans s'affichaient vides — les requêtes étant
 * conditionnées à la session, aucune n'était même envoyée, et rien n'expliquait
 * l'écran blanc. Tout écran authentifié passe par ce composant.
 */
export function Screen({
  children,
  isLoading,
  error,
  onRetry,
  refreshing,
  onRefresh,
}: {
  children: React.ReactNode;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const t = useTheme();
  const { status } = useSession();

  if (status === 'signed-out') return <Redirect href="/login" />;
  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.energy} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: space.md, gap: space.lg, paddingBottom: space.xxl }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={Boolean(refreshing)}
                onRefresh={onRefresh}
                tintColor={t.textSecondary}
              />
            ) : undefined
          }
        >
          {error ? (
            <ErrorState message={messageFor(error)} onRetry={onRetry ?? (() => {})} />
          ) : isLoading ? (
            <LoadingSkeleton />
          ) : (
            children
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function LoadingSkeleton() {
  return (
    <View style={{ gap: space.md }}>
      <SkeletonCard />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <SkeletonCard />
        <SkeletonCard />
      </View>
    </View>
  );
}

/** Bandeau discret quand le canal temps réel est coupé (doc §14). */
export function ConnectionBanner() {
  const t = useTheme();
  const { connected, enabled } = useRealtime();
  // Sans foyer sélectionné, il n'y a rien à quoi se connecter : annoncer une
  // « reconnexion » serait faux.
  if (connected || !enabled) return null;

  return (
    <Card
      bordered
      padding={space.sm + 4}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm + 2,
        backgroundColor: t.surfaceRaised,
      }}
    >
      <CloudOff size={18} color={t.textSecondary} strokeWidth={iconStroke} />
      <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
        Reconnexion en cours — les états affichés peuvent être en retard.
      </Txt>
    </Card>
  );
}

export function messageFor(error: unknown): string {
  if (!(error instanceof ApiException)) {
    // En développement, on affiche l'adresse visée : la cause la plus fréquente
    // est un `localhost` inatteignable depuis un téléphone physique.
    return __DEV__
      ? `Le serveur est injoignable (${API_URL}).`
      : 'Le serveur est injoignable — vérifiez votre connexion.';
  }
  switch (error.code) {
    case 'unit_offline':
      return 'L’appareil est hors ligne.';
    case 'command_timeout':
      return 'La commande n’a pas atteint l’appareil.';
    case 'device_rejected':
      return 'L’appareil a refusé la commande.';
    case 'connector_quota_exceeded':
      return 'Trop de commandes envoyées au fabricant — patientez un instant.';
    case 'third_party_reauth_required':
      return 'Un compte connecté doit être relié à nouveau.';
    case 'forbidden':
      return 'Vous n’avez pas les droits pour cette action.';
    case 'not_found':
      return 'Cet élément n’existe plus.';
    default:
      return 'L’action a échoué.';
  }
}
