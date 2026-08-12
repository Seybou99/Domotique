import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Cloud, Plug, Radio, Wifi } from 'lucide-react-native';
import { Button, Card, ScreenHeader, Txt } from '../../src/components';
import { useTheme } from '../../src/theme/ThemeProvider';
import { iconStroke, radius, space } from '../../src/theme/tokens';

/**
 * Écrans 4 et 5 — Déballage du boîtier, et choix du parcours.
 *
 * Écart assumé avec le §7 : le boîtier n'est pas un passage obligé. Un client
 * qui n'a que des prises Wi-Fi n'en a pas, et le forcer à traverser des écrans
 * de déballage pour rien est le meilleur moyen de le perdre. Les deux voies sont
 * donc présentées côte à côte, comme l'écran 2.4 le fait déjà pour l'ajout
 * d'appareil.
 */
export default function Hub() {
  const t = useTheme();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.md, gap: space.lg, flexGrow: 1 }}>
          <ScreenHeader title="Votre boîtier" subtitle="Étape 2 sur 3" onBack={() => router.back()} />

          <Txt variant="body" tone="secondary">
            Le boîtier est le pont entre vos appareils Zigbee et l’application. Les appareils
            Wi-Fi, eux, n’en ont pas besoin.
          </Txt>

          <Card style={{ gap: space.lg }}>
            <Txt variant="card">Préparer le boîtier</Txt>
            <Step
              index={1}
              icon={<Plug size={20} color={t.energy} strokeWidth={iconStroke} />}
              title="Branchez-le"
              text="Sur une prise murale, de préférence au centre du logement — la portée radio compte."
            />
            <Step
              index={2}
              icon={<Wifi size={20} color={t.energy} strokeWidth={iconStroke} />}
              title="Attendez le voyant"
              text="Il clignote pendant le démarrage, puis reste fixe. Comptez environ une minute."
            />
            <Step
              index={3}
              icon={<Radio size={20} color={t.energy} strokeWidth={iconStroke} />}
              title="Munissez-vous du QR code"
              text="Il est collé sous le boîtier ou sur sa boîte."
            />
          </Card>

          <View style={{ flex: 1 }} />

          <View style={{ gap: space.sm }}>
            <Button
              label="Scanner le QR code"
              onPress={() => router.push('/onboarding/scan')}
              full
            />
            <Card
              onPress={() => router.push('/onboarding/room')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
            >
              <Cloud size={22} color={t.network} strokeWidth={iconStroke} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">Je n’ai pas encore de boîtier</Txt>
                <Txt variant="caption" tone="secondary">
                  Vous pourrez l’ajouter plus tard, et utiliser dès maintenant vos appareils Wi-Fi.
                </Txt>
              </View>
            </Card>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Step({
  index,
  icon,
  title,
  text,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.energySoft,
          borderWidth: 1,
          borderColor: t.energyRing,
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">
          {index}. {title}
        </Txt>
        <Txt variant="caption" tone="secondary">
          {text}
        </Txt>
      </View>
    </View>
  );
}
