import React from 'react';
import { View } from 'react-native';
import { Bell } from 'lucide-react-native';
import type { Alert } from '@domotique/contract';
import { Button, Card, EmptyState, ScreenHeader, StatusChip, Txt } from '../../src/components';
import { Screen, ConnectionBanner } from '../../src/screens/shared';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/tokens';
import { useHome } from '../../src/api/HomeProvider';
import { useAlerts, useMarkAlertsRead } from '../../src/api/hooks';
import { formatDateTime } from '../../src/lib/dates';

const CATEGORIES: Record<Alert['category'], string> = {
  security: 'Sécurité',
  safety: 'Sûreté',
  connectivity: 'Connexion',
  activity: 'Activité',
};

/** Écran 4.1 — Fil d'alertes. */
export default function Alerts() {
  const t = useTheme();
  const { home } = useHome();
  const alerts = useAlerts(home?.id);
  const markRead = useMarkAlertsRead(home?.id);

  const items = alerts.data?.items ?? [];
  const unread = alerts.data?.unread_count ?? 0;

  return (
    <Screen
      isLoading={alerts.isLoading}
      error={alerts.error}
      onRetry={() => void alerts.refetch()}
      refreshing={alerts.isFetching && !alerts.isLoading}
      onRefresh={() => void alerts.refetch()}
    >
      <ScreenHeader
        title="Alertes"
        subtitle={unread > 0 ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout est à jour'}
        right={
          unread > 0 ? (
            <Button label="Tout lire" variant="secondary" onPress={() => markRead.mutate()} />
          ) : undefined
        }
      />
      <ConnectionBanner />

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Aucun événement pour l’instant"
          actionLabel="Rafraîchir"
          onAction={() => void alerts.refetch()}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {items.map((alert) => (
            <Card
              key={alert.id}
              level={alert.read ? 'surface' : 'raised'}
              style={{ gap: space.sm }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {/* Une alerte non lue est signalée par une pastille ET par le
                    fond : le doc §15 interdit de coder l'information par la
                    seule couleur. */}
                {!alert.read && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: radius.pill,
                      backgroundColor: toneColor(alert.severity, t),
                    }}
                  />
                )}
                <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                  {alert.title}
                </Txt>
                <StatusChip
                  label={CATEGORIES[alert.category]}
                  tone={chipTone(alert.severity)}
                  dot={false}
                />
              </View>

              {alert.body && (
                <Txt variant="caption" tone="secondary">
                  {alert.body}
                </Txt>
              )}

              <Txt variant="dataMicro" tone="muted">
                {formatDateTime(alert.created_at)}
              </Txt>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function chipTone(severity: Alert['severity']) {
  return severity === 'critical' ? 'alert' : severity === 'warning' ? 'energy' : 'online';
}

function toneColor(severity: Alert['severity'], t: { danger: string; energy: string; network: string }) {
  return severity === 'critical' ? t.danger : severity === 'warning' ? t.energy : t.network;
}

