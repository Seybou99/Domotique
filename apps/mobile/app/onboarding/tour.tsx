import React, { useRef, useState } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Bell, Home, LayoutGrid, Sparkles } from 'lucide-react-native';
import { Button, Card, Txt } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { iconStroke, radius, space } from '../../src/theme/tokens';

/**
 * Écran 9 — Tour guidé, explicitement facultatif dans le §7.
 *
 * Quatre cartes, une par onglet. Le bouton « Passer » est présent dès la
 * première : un tour qu'on ne peut pas quitter n'est plus un tour, c'est un
 * péage.
 */
const CARDS = [
  {
    icon: Home,
    title: 'Accueil',
    text: 'Vos pièces d’un coup d’œil, avec ce qui est allumé et ce que vous consommez aujourd’hui.',
  },
  {
    icon: LayoutGrid,
    title: 'Appareils',
    text: 'La liste complète, filtrable. Touchez un appareil pour son détail et son historique.',
  },
  {
    icon: Sparkles,
    title: 'Scénarios',
    text: 'Enchaînez plusieurs appareils d’un geste, ou déclenchez-les à une heure donnée.',
  },
  {
    icon: Bell,
    title: 'Alertes',
    text: 'Ouvertures, fuites, appareils hors ligne. Vous choisissez ce qui vous notifie.',
  },
];

export default function Tour() {
  const t = useTheme();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const width = Dimensions.get('window').width - space.md * 2;

  const finish = () => router.replace('/(tabs)');

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: space.lg }}>
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.md }}
            onMomentumScrollEnd={(event) =>
              setPage(Math.round(event.nativeEvent.contentOffset.x / width))
            }
            style={{ flexGrow: 0 }}
          >
            {CARDS.map(({ icon: Icon, title, text }) => (
              <View key={title} style={{ width, justifyContent: 'center' }}>
                <Card style={{ gap: space.lg, minHeight: 320, justifyContent: 'center' }}>
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: t.energySoft,
                      borderWidth: 1,
                      borderColor: t.energyRing,
                    }}
                  >
                    <Icon size={28} color={t.energy} strokeWidth={iconStroke} />
                  </View>
                  <Txt variant="section" tight>
                    {title}
                  </Txt>
                  <Txt variant="body" tone="secondary">
                    {text}
                  </Txt>
                </Card>
              </View>
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.sm }}>
            {CARDS.map((card, index) => (
              <View
                key={card.title}
                style={{
                  width: index === page ? 20 : 6,
                  height: 6,
                  borderRadius: radius.pill,
                  backgroundColor: index === page ? t.energy : t.track,
                }}
              />
            ))}
          </View>

          <View style={{ paddingHorizontal: space.md, gap: space.sm }}>
            {page < CARDS.length - 1 ? (
              <>
                <Button
                  label="Suivant"
                  full
                  onPress={() => scroller.current?.scrollTo({ x: (page + 1) * width, animated: true })}
                />
                <Button label="Passer" variant="ghost" onPress={finish} full />
              </>
            ) : (
              <Button label="Découvrir mon foyer" onPress={finish} full />
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
