import React from 'react';
import { View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { EmptyState, IconButton, SceneRow, ScreenHeader } from '../../src/components';
import { Screen, ConnectionBanner } from '../../src/screens/shared';
import { sceneIcons, type SceneKind } from '../../src/lib/icons';
import { iconStroke, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useHome } from '../../src/api/HomeProvider';
import { useAutomations, useRunAutomation, useToggleAutomation } from '../../src/api/hooks';
import { formatDateTimeLong } from '../../src/lib/dates';

/** Écran 3.1 — Liste des scénarios. */
export default function Scenarios() {
  const t = useTheme();
  const router = useRouter();
  const { home } = useHome();
  const automations = useAutomations(home?.id);
  const run = useRunAutomation(home?.id);
  const toggle = useToggleAutomation(home?.id);

  return (
    <Screen
      isLoading={automations.isLoading}
      error={automations.error}
      onRetry={() => void automations.refetch()}
      refreshing={automations.isFetching && !automations.isLoading}
      onRefresh={() => void automations.refetch()}
    >
      <ScreenHeader
        title="Scénarios"
        subtitle={`${automations.data?.length ?? 0} configuré${(automations.data?.length ?? 0) > 1 ? 's' : ''}`}
        right={
          <IconButton
            icon={<Plus size={22} color={t.onEnergy} strokeWidth={iconStroke} />}
            variant="primary"
            accessibilityLabel="Créer un scénario"
            onPress={() => router.navigate('/scenario-form')}
          />
        }
      />
      <ConnectionBanner />

      {(automations.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={sceneIcons.cinema}
          title="Aucun scénario pour l’instant"
          actionLabel="Créer un scénario"
          onAction={() => router.navigate('/scenario-form')}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {automations.data?.map((automation) => (
            <SceneRow
              key={automation.id}
              icon={sceneIcons[automation.icon as SceneKind] ?? sceneIcons.cinema}
              name={automation.name}
              // Le résumé vient du serveur : c'est lui qui exécute, donc lui
              // seul peut décrire ce qui se passera réellement.
              trigger={automation.summary}
              enabled={automation.enabled}
              onToggle={(enabled) => toggle.mutate({ id: automation.id, enabled })}
              onRun={() => run.mutate(automation.id)}
              lastRun={formatLastRun(automation.last_run)}
              onPress={() => router.navigate(`/scenario-form?id=${automation.id}`)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function formatLastRun(last: { at: string; status: string } | null): string | undefined {
  if (!last) return undefined;
  const suffix = last.status === 'success' ? '' : ` · ${labelFor(last.status)}`;
  return `${formatDateTimeLong(last.at)}${suffix}`;
}

function labelFor(status: string): string {
  return status === 'partial' ? 'partiel' : 'échec';
}

