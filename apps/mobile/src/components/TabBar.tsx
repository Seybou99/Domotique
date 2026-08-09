import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Home, LayoutGrid, Sparkles, User, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Txt } from './Txt';
import { iconStroke, radius, space } from '../theme/tokens';

/**
 * Barre de navigation basse à 5 onglets (doc §6).
 *
 * Choix assumé : l'onglet actif est rendu en **blanc**, pas en ambre. Les deux
 * accents encodent une information produit (énergie / réseau) ; les employer
 * pour de la navigation les viderait de leur sens. Un badge d'alerte reste
 * rouge, car il porte, lui, une vraie information.
 */
export type TabKey = 'accueil' | 'appareils' | 'scenarios' | 'alertes' | 'profil';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'accueil', label: 'Accueil', icon: Home },
  { key: 'appareils', label: 'Appareils', icon: LayoutGrid },
  { key: 'scenarios', label: 'Scénarios', icon: Sparkles },
  { key: 'alertes', label: 'Alertes', icon: Bell },
  { key: 'profil', label: 'Profil', icon: User },
];

export function TabBar({
  active,
  onChange,
  badges,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
  /** Nombre d'éléments non lus par onglet (typiquement Alertes). */
  badges?: Partial<Record<TabKey, number>>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.surfaceSunken,
        borderTopWidth: 1,
        borderTopColor: t.line,
        paddingTop: space.sm + 2,
        paddingBottom: Math.max(insets.bottom, space.sm + 2),
      }}
    >
      {TABS.map(({ key, label, icon: Icon }) => {
        const isActive = key === active;
        const badge = badges?.[key] ?? 0;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={badge > 0 ? `${label}, ${badge} non lus` : label}
            style={{ flex: 1, alignItems: 'center', gap: space.xs, minHeight: 44 }}
          >
            <View>
              <Icon
                size={22}
                color={isActive ? t.text : t.textMuted}
                strokeWidth={iconStroke}
                fill={isActive ? t.pressed : 'none'}
              />
              {badge > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -3,
                    right: -6,
                    minWidth: 16,
                    height: 16,
                    paddingHorizontal: 4,
                    borderRadius: radius.pill,
                    backgroundColor: t.danger,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Txt variant="dataMicro" style={{ color: '#FFFFFF', fontSize: 10, lineHeight: 12 }}>
                    {badge > 9 ? '9+' : badge}
                  </Txt>
                </View>
              )}
            </View>
            <Txt variant="micro" tone={isActive ? 'primary' : 'muted'} style={{ fontSize: 11 }}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
