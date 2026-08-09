import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Moon, Plus, Sun } from 'lucide-react-native';
import {
  Button,
  Card,
  DeviceRow,
  EmptyState,
  ErrorState,
  FilterChip,
  HomeSummary,
  IconButton,
  LevelSlider,
  OfflineBanner,
  ProtocolBadge,
  RoomCard,
  SceneRow,
  SceneTile,
  ScreenHeader,
  SectionHeader,
  SkeletonCard,
  StatusChip,
  TabBar,
  Toggle,
  Txt,
  VerticalLevelSlider,
  type TabKey,
} from '../src/components';
import { useTheme, useThemeMode } from '../src/theme/ThemeProvider';
import { deviceIcons, roomIcons, sceneIcons } from '../src/lib/icons';
import { toDeviceRow } from '../src/api/adapters';
import { mockDevices, mockRoomNames } from '../src/api/mocks';
import { iconStroke, radius, space } from '../src/theme/tokens';

/**
 * Galerie du design system.
 *
 * Écran de référence, pas un écran produit : il sert à valider les composants et
 * les deux modes avant de câbler les fonctionnalités. Il n'est pas destiné à
 * rester dans le build de production.
 */
export default function DesignSystemGallery() {
  const t = useTheme();
  const { mode, setMode } = useThemeMode();

  const [tab, setTab] = useState<TabKey>('accueil');
  const [filter, setFilter] = useState('Tous');
  const [plafonnier, setPlafonnier] = useState(true);
  const [priseTV, setPriseTV] = useState(true);
  const [pending, setPending] = useState(false);
  const [brightness, setBrightness] = useState(62);
  const [vertical, setVertical] = useState(62);
  const [cinema, setCinema] = useState(true);
  const [deviceStates, setDeviceStates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      mockDevices.map((d) => [
        d.id,
        d.capabilities.find((c) => c.type === 'on_off')?.value?.type === 'on_off'
          ? (d.capabilities.find((c) => c.type === 'on_off')!.value as { value: boolean }).value
          : false,
      ]),
    ),
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: space.md, gap: space.xl, paddingBottom: space.xxl }}
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            title="Design system"
            subtitle="Veille active · v1.0"
            right={
              <IconButton
                icon={
                  mode === 'dark' ? (
                    <Sun size={20} color={t.text} strokeWidth={iconStroke} />
                  ) : (
                    <Moon size={20} color={t.text} strokeWidth={iconStroke} />
                  )
                }
                accessibilityLabel="Basculer entre mode sombre et mode clair"
                onPress={() => setMode(mode === 'dark' ? 'light' : 'dark')}
              />
            }
          />

          {/* ---------------------------------------------------------- Couleurs */}
          <Section title="Couleurs">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Swatch color={t.bg} label="bg" />
              <Swatch color={t.surface} label="surface" />
              <Swatch color={t.surfaceRaised} label="raised" />
              <Swatch color={t.track} label="track" />
              <Swatch color={t.energy} label="energy" />
              <Swatch color={t.network} label="network" />
              <Swatch color={t.success} label="success" />
              <Swatch color={t.danger} label="danger" />
            </View>
            <Txt variant="caption" tone="secondary">
              L’ambre n’est jamais décoratif : il signifie lumière, chauffage ou consommation. La
              sarcelle signifie connecté, synchronisé, en ligne.
            </Txt>
          </Section>

          {/* -------------------------------------------------------- Typographie */}
          <Section title="Typographie">
            <Card style={{ gap: space.sm }}>
              <Txt variant="screen" tight>
                Titre d’écran 34
              </Txt>
              <Txt variant="section" tight>
                Titre de section 28
              </Txt>
              <Txt variant="card">Titre de carte 22</Txt>
              <Txt variant="body">Corps de texte 17 — Inter, interlignage 1,4</Txt>
              <Txt variant="caption" tone="secondary">
                Légende 15 — texte secondaire
              </Txt>
              <Txt variant="data" tone="secondary">
                Donnée mono 15 — 21:04 · 62 % · 0,064 kWh
              </Txt>
              <Txt variant="dataMicro" tone="muted">
                Micro mono 13 — 0x0001a3f · il y a 2 s
              </Txt>
            </Card>
          </Section>

          {/* ------------------------------------------------------ Hero + pièces */}
          <Section title="Tableau de bord">
            <HomeSummary activeDevices={6} totalDevices={10} energyToday="4,2" hubOnline />
            <SectionHeader title="Scènes" actionLabel="Tout voir" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm }}
            >
              <SceneTile icon={sceneIcons.cinema} name="Soirée cinéma" running />
              <SceneTile icon={sceneIcons.nuit} name="Bonne nuit" />
              <SceneTile icon={sceneIcons.depart} name="Départ" />
              <SceneTile icon={sceneIcons.reveil} name="Réveil" />
            </ScrollView>

            <SectionHeader title="Pièces" actionLabel="Réorganiser" />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <RoomCard icon={roomIcons.salon} name="Salon" activeCount={3} totalCount={3} />
              <RoomCard icon={roomIcons.cuisine} name="Cuisine" activeCount={1} totalCount={2} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <RoomCard icon={roomIcons.chambre} name="Chambre" activeCount={0} totalCount={2} />
              <RoomCard icon={roomIcons.entree} name="Entrée" activeCount={0} totalCount={1} online={false} />
            </View>
          </Section>

          {/* ---------------------------------------------------------- Contrôles */}
          <Section title="Contrôles">
            <Card style={{ gap: space.md }}>
              <Row label="Bascule ambre — éclairage">
                <Toggle value={plafonnier} onValueChange={setPlafonnier} accessibilityLabel="Plafonnier" />
              </Row>
              <Row label="Bascule sarcelle — prise">
                <Toggle value={priseTV} onValueChange={setPriseTV} tone="network" accessibilityLabel="Prise TV" />
              </Row>
              <Row label="En attente de confirmation">
                <Toggle value={pending} onValueChange={setPending} pending accessibilityLabel="Démonstration" />
              </Row>
              <Row label="Désactivée">
                <Toggle value={false} disabled accessibilityLabel="Désactivée" />
              </Row>
            </Card>

            <LevelSlider
              value={brightness}
              onChange={setBrightness}
              accessibilityLabel="Luminosité du plafonnier"
            />
            <LevelSlider
              value={40}
              tone="network"
              unit="°C"
              accessibilityLabel="Température de consigne"
            />

            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Button label="Activer la scène" onPress={() => {}} />
              <Button label="Secondaire" variant="secondary" onPress={() => {}} />
              <Button label="Supprimer" variant="danger" onPress={() => {}} />
              <IconButton
                icon={<Plus size={22} color={t.onEnergy} strokeWidth={iconStroke} />}
                variant="primary"
                accessibilityLabel="Ajouter un appareil"
              />
            </View>

            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {['Tous', 'Éclairage', 'Prises', 'Zigbee', 'Cloud'].map((f) => (
                <FilterChip key={f} label={f} selected={filter === f} onPress={() => setFilter(f)} />
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusChip label="en ligne" tone="online" />
              <StatusChip label="hors ligne" tone="offline" />
              <StatusChip label="Fermé" tone="success" />
              <StatusChip label="Mouvement" tone="alert" />
              <ProtocolBadge protocol="Zigbee" />
              <ProtocolBadge protocol="Tuya" />
              <ProtocolBadge protocol="Hue" />
            </View>
          </Section>

          {/* ----------------------------------------------------------- Appareils */}
          {/* Ces lignes ne sont pas écrites à la main : elles viennent d'objets
              `Device` validés par @domotique/contract, traduits en props par
              `toDeviceRow`. C'est le premier point de contact réel entre le
              contrat et le design system. */}
          <Section title="Appareils">
            <View style={{ gap: space.sm }}>
              {mockDevices.map((d) => (
                <DeviceRow
                  key={d.id}
                  {...toDeviceRow(d, {
                    roomName: d.room_id ? mockRoomNames[d.room_id] : undefined,
                    pending: d.id === '44444444-4444-4444-8444-444444444444',
                    onValueChange: (v) => setDeviceStates((prev) => ({ ...prev, [d.id]: v })),
                  })}
                  value={deviceStates[d.id]}
                />
              ))}
            </View>
          </Section>

          {/* ------------------------------------------------------------- Scènes */}
          <Section title="Scénarios">
            <SceneRow
              icon={sceneIcons.cinema}
              name="Soirée cinéma"
              trigger="Manuel"
              lastRun="Hier à 21:12"
              enabled={cinema}
              onToggle={setCinema}
            />
            <SceneRow
              icon={sceneIcons.nuit}
              name="Bonne nuit"
              trigger="Chaque soir à 23:30"
              lastRun="Cette nuit à 23:30"
              enabled
            />
          </Section>

          {/* ------------------------------------------- Détail appareil (vertical) */}
          <Section title="Détail d’un appareil">
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <VerticalLevelSlider
                value={vertical}
                onChange={setVertical}
                height={220}
                style={{ width: 110 }}
                accessibilityLabel="Luminosité"
              />
              <View style={{ flex: 1, gap: space.sm }}>
                <Card
                  tint={plafonnier ? 'energy' : 'none'}
                  onPress={() => setPlafonnier((v) => !v)}
                  style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm }}
                  accessibilityLabel="Allumer ou éteindre le plafonnier"
                >
                  <Txt variant="card" tone={plafonnier ? 'energy' : 'secondary'}>
                    {plafonnier ? 'Allumé' : 'Éteint'}
                  </Txt>
                </Card>
                <Card level="raised" style={{ gap: space.xs }}>
                  <Txt variant="micro" tone="secondary">
                    Consommation
                  </Txt>
                  <Txt variant="section" tone="energy" tight>
                    0,064 kWh
                  </Txt>
                  <Txt variant="dataMicro" tone="muted">
                    aujourd’hui
                  </Txt>
                </Card>
              </View>
            </View>
          </Section>

          {/* -------------------------------------------------- États systémiques */}
          <Section title="États systémiques">
            <OfflineBanner count={2} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <SkeletonCard />
              <SkeletonCard />
            </View>
            <EmptyState
              icon={deviceIcons.light}
              title="Aucun appareil dans cette pièce"
              actionLabel="Ajouter un appareil"
              onAction={() => {}}
            />
            <ErrorState message="La commande n’a pas atteint l’appareil." onRetry={() => {}} />
          </Section>
        </ScrollView>
      </SafeAreaView>

      <TabBar active={tab} onChange={setTab} badges={{ alertes: 3 }} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.md,
      }}
    >
      <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.xs, width: 68 }}>
      <View
        style={{
          width: 68,
          height: 48,
          borderRadius: radius.control,
          backgroundColor: color,
          borderWidth: 1,
          borderColor: t.lineStrong,
        }}
      />
      <Txt variant="dataMicro" tone="muted" numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}
