import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AlertTriangle, Check, Eye, EyeOff, Wifi } from 'lucide-react-native';
import { Button, Card, DeviceAvatar, ScreenHeader, StatusChip, Txt } from '../src/components';
import { Screen, messageFor } from '../src/screens/shared';
import { deviceIcons } from '../src/lib/icons';
import { useTheme } from '../src/theme/ThemeProvider';
import { font, fontSize, iconStroke, radius, space } from '../src/theme/tokens';
import { useHome } from '../src/api/HomeProvider';
import { useIntegrations } from '../src/api/hooks';
import { useTuyaPairing } from '../src/api/useTuyaPairing';
import type { DiscoveredDevice } from '../modules/tuya-pairing';

/**
 * Appairage d'un appareil connecté, depuis l'application.
 *
 * **On cherche d'abord, on saisit ensuite.** Les appareils récents s'annoncent en
 * Bluetooth tant qu'ils ne sont pas appairés : les découvrir avant toute saisie
 * évite de taper un réseau à l'aveugle sans savoir si quelqu'un écoute en face.
 * C'est ce que fait l'application du fabricant, et la raison pour laquelle elle
 * aboutit là où une saisie préalable échouait sans rien expliquer.
 *
 * Le réseau est demandé une fois l'appareil choisi, et l'appareil lui-même dit
 * quels réseaux il capte : la liste ne contient donc que des choix qui peuvent
 * marcher — un appareil qui ne voit pas le 5 GHz ne le proposera pas.
 *
 * **Les étapes sont des composants de module**, et non des fonctions internes.
 * Déclarées dans le composant, elles seraient recréées à chaque rendu : React y
 * verrait un nouveau type, démonterait le sous-arbre et le remonterait. Un champ
 * de saisie perdrait le focus à chaque caractère.
 */
type Step = 'prepare' | 'network';

/** D'où vient une valeur préremplie — le dire évite de la prendre pour une saisie oubliée. */
type Prefill = 'none' | 'remembered' | 'detected';

export default function DevicePairWifi() {
  const router = useRouter();
  const { home } = useHome();
  const integrations = useIntegrations(home?.id);
  const pairing = useTuyaPairing();

  const [step, setStep] = useState<Step>('prepare');
  const [selected, setSelected] = useState<DiscoveredDevice | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [prefill, setPrefill] = useState<Prefill>('none');
  const [nearby, setNearby] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Lue dans une promesse résolue plus tard : la valeur capturée par la fermeture
  // serait celle du rendu qui a lancé la détection.
  const ssidRef = useRef('');
  ssidRef.current = ssid;

  // Capturé dans une constante : le narrowing d'une propriété d'objet ne survit
  // pas à une fermeture, et les gestionnaires ci-dessous en ont besoin.
  const state = pairing.state;

  /**
   * Préremplissage du réseau, à l'entrée de l'étape — pas au montage de l'écran :
   * la demande d'autorisation de localisation qu'il peut déclencher n'a de sens
   * qu'en regard d'un champ « nom du réseau ».
   *
   * Le réseau retenu d'un appairage précédent passe avant celui que détecte le
   * système : lui seul porte le mot de passe, et il a déjà fait ses preuves.
   */
  useEffect(() => {
    if (step !== 'network' || !selected) return;
    let cancelled = false;

    void (async () => {
      // Ce que l'appareil capte, demandé en premier : la réponse met quelques
      // secondes et la liste guide le choix mieux qu'un champ vide.
      void pairing.networksNearDevice(selected.uuid).then((list) => {
        if (!cancelled) setNearby(list);
      });

      const remembered = await pairing.rememberedNetwork();
      if (cancelled || ssidRef.current.length > 0) return;
      if (remembered) {
        setSsid(remembered.ssid);
        setPassword(remembered.password);
        setPrefill('remembered');
        return;
      }

      const found = await pairing.detectSsid();
      if (cancelled || !found || ssidRef.current.length > 0) return;
      setSsid(found);
      setPrefill('detected');
    })();

    return () => {
      cancelled = true;
    };
  }, [step, selected, pairing.detectSsid, pairing.rememberedNetwork, pairing.networksNearDevice]);

  /**
   * L'appareil appairé appartient au compte technique, dans le projet cloud du
   * fournisseur. L'import le fait entrer dans le foyer côté serveur — c'est lui
   * qui le rendra pilotable, le SDK ne servant qu'à l'appairage.
   */
  async function addToHome(deviceId: string) {
    setImportError(null);
    setImporting(true);
    try {
      const { account } = await integrations.linkConsole.mutateAsync('tuya');
      const { devices } = await integrations.importDevices.mutateAsync({
        accountId: account.id,
        externalIds: [deviceId],
      });

      // La console du fournisseur met quelques secondes à publier un appareil
      // tout juste appairé. Import vide ne veut pas dire échec : il faut réessayer.
      if (devices.length === 0) {
        setImportError(
          'L’appareil est appairé mais pas encore publié par le fournisseur. Réessayez dans quelques secondes.',
        );
        return;
      }
      router.replace('/(tabs)');
    } catch (caught) {
      setImportError(messageFor(caught));
    } finally {
      setImporting(false);
    }
  }

  function back() {
    if (state.step === 'failed' || state.step === 'found' || state.step === 'pairing') {
      pairing.reset();
      setStep('prepare');
      setSelected(null);
      return;
    }
    if (step === 'network') {
      setStep('prepare');
      setSelected(null);
      pairing.reset();
      return;
    }
    if (state.step === 'scanning') {
      pairing.reset();
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <ScreenHeader title="Appareil connecté" onBack={back} />

      {!pairing.isAvailable && (
        <Card tint="danger" style={{ gap: space.sm }}>
          <Txt variant="bodyStrong">Appairage indisponible</Txt>
          <Txt variant="caption" tone="secondary">
            Cette fonction demande un build de développement — elle n’existe pas dans Expo Go. Vous
            pouvez toujours appairer l’appareil dans l’application de son fabricant, puis l’importer
            depuis « Compte connecté ».
          </Txt>
        </Card>
      )}

      {state.step === 'idle' && step === 'prepare' && (
        <PrepareStep onSearch={() => void pairing.scan()} disabled={!pairing.isAvailable} />
      )}

      {state.step === 'scanning' && (
        <ScanningStep
          devices={state.devices}
          onPick={(device) => {
            setSelected(device);
            setStep('network');
          }}
          onRestart={() => void pairing.scan()}
        />
      )}

      {step === 'network' && selected && state.step !== 'pairing' && state.step !== 'found' && state.step !== 'failed' && (
        <NetworkStep
          device={selected}
          ssid={ssid}
          password={password}
          revealed={revealed}
          prefill={prefill}
          nearby={nearby}
          busy={state.step === 'preparing'}
          onSsid={(value) => {
            setSsid(value);
            setPrefill('none');
          }}
          onPassword={(value) => {
            setPassword(value);
            setPrefill('none');
          }}
          onReveal={() => setRevealed((shown) => !shown)}
          onLaunch={() => void pairing.pair(selected, ssid.trim(), password)}
        />
      )}

      {state.step === 'pairing' && <PairingStep progress={state.progress} />}

      {state.step === 'found' && (
        <FoundStep
          device={state.device}
          importing={importing}
          error={importError}
          onAdd={() => addToHome(state.device.deviceId)}
        />
      )}

      {state.step === 'failed' && (
        <FailedStep
          message={state.message}
          onRetry={() => {
            pairing.reset();
            setSelected(null);
            setStep('prepare');
          }}
          onGiveUp={() => router.back()}
        />
      )}
    </Screen>
  );
}

// ───────────────────────────────────────────────────────────── étape 1 : préparer

function PrepareStep({ onSearch, disabled }: { onSearch: () => void; disabled?: boolean }) {
  const t = useTheme();

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
        <DeviceAvatar icon={deviceIcons.plug} size={72} tone="network" />
        <Txt variant="card">Préparez l’appareil</Txt>
        <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          Deux gestes, puis l’application le trouvera toute seule.
        </Txt>
      </Card>

      <Card style={{ gap: space.md }}>
        <Instruction index={1} text="Branchez l’appareil et attendez qu’il s’allume." />
        <Instruction
          index={2}
          text="Maintenez son bouton environ 5 secondes, jusqu’à ce que le voyant clignote rapidement."
        />
      </Card>

      {/* Le 2,4 GHz est la première cause d'échec, et elle est invisible :
          le téléphone marche très bien en 5 GHz, l'appareil n'y arrive pas. */}
      <Card tint="network" style={{ flexDirection: 'row', gap: space.md }}>
        <Wifi size={20} color={t.network} strokeWidth={iconStroke} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Txt variant="bodyStrong">Réseau 2,4 GHz obligatoire</Txt>
          <Txt variant="caption" tone="secondary">
            Ces appareils ne captent pas le 5 GHz. Si votre box diffuse deux réseaux, choisissez
            celui en 2,4 GHz — souvent le même nom, sans le suffixe « 5G ».
          </Txt>
        </View>
      </Card>

      <Card style={{ flexDirection: 'row', gap: space.md }}>
        <AlertTriangle size={20} color={t.textSecondary} strokeWidth={iconStroke} />
        <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
          Le Bluetooth doit être activé : c’est par lui que l’appareil se signale, avant même d’avoir
          un réseau.
        </Txt>
      </Card>

      <Button label="Rechercher les appareils" full disabled={disabled} onPress={onSearch} />
    </View>
  );
}

// ──────────────────────────────────────────────────────────── étape 2 : recherche

function ScanningStep({
  devices,
  onPick,
  onRestart,
}: {
  devices: DiscoveredDevice[];
  onPick: (device: DiscoveredDevice) => void;
  onRestart: () => void;
}) {
  const t = useTheme();

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
        <ActivityIndicator color={t.network} />
        <Txt variant="card">Recherche en cours</Txt>
        <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          Restez près de l’appareil. Il apparaîtra dès qu’il se sera signalé.
        </Txt>
      </Card>

      {devices.length === 0 ? (
        <Card style={{ gap: space.sm }}>
          <Txt variant="caption" tone="secondary">
            Aucun appareil pour l’instant. Vérifiez que le voyant clignote rapidement — sans quoi
            l’appareil n’émet rien. Au besoin, refaites la manipulation du bouton.
          </Txt>
          <Button label="Relancer la recherche" variant="secondary" full onPress={onRestart} />
        </Card>
      ) : (
        <View style={{ gap: space.sm }}>
          <Txt variant="card">
            {devices.length} appareil{devices.length > 1 ? 's' : ''} trouvé
            {devices.length > 1 ? 's' : ''}
          </Txt>
          {devices.map((device) => (
            <Card
              key={device.uuid}
              onPress={() => onPick(device)}
              accessibilityLabel={`Appairer l’appareil ${device.mac}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
            >
              <DeviceAvatar icon={deviceIcons.plug} size={44} active tone="network" />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">Appareil à appairer</Txt>
                <Txt variant="dataMicro" tone="secondary" numberOfLines={1}>
                  {device.mac || device.uuid}
                </Txt>
              </View>
              <Txt variant="micro" tone="energy">
                Choisir
              </Txt>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────── étape 3 : réseau

function NetworkStep({
  device,
  ssid,
  password,
  revealed,
  prefill,
  nearby,
  busy,
  onSsid,
  onPassword,
  onReveal,
  onLaunch,
}: {
  device: DiscoveredDevice;
  ssid: string;
  password: string;
  revealed: boolean;
  prefill: Prefill;
  nearby: string[];
  busy: boolean;
  onSsid: (value: string) => void;
  onPassword: (value: string) => void;
  onReveal: () => void;
  onLaunch: () => void;
}) {
  const t = useTheme();
  const field = fieldStyle(t);

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.sm }}>
        <Txt variant="card">Votre réseau Wi-Fi</Txt>
        <Txt variant="caption" tone="secondary">
          L’appareil a besoin de ces identifiants pour rejoindre votre réseau. Ils lui sont transmis
          par Bluetooth, sans passer par nos serveurs.
        </Txt>
        {!device.supports5G && (
          <Txt variant="micro" tone="network">
            Cet appareil ne capte que le 2,4 GHz.
          </Txt>
        )}
      </Card>

      {/* Les réseaux que l'appareil capte lui-même : un choix dans cette liste ne
          peut pas être une faute de frappe, ni un réseau hors de portée. */}
      {nearby.length > 0 && (
        <Card style={{ gap: space.sm }}>
          <Txt variant="micro" tone="secondary">
            Réseaux vus par l’appareil
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {nearby.map((name) => {
              const active = ssid === name;
              return (
                <Pressable
                  key={name}
                  onPress={() => onSsid(name)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    height: 36,
                    paddingHorizontal: space.md - 4,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: active ? t.energyRing : t.lineStrong,
                    backgroundColor: active ? t.energySoft : 'transparent',
                  }}
                >
                  <Txt variant="micro" tone={active ? 'energy' : 'secondary'}>
                    {name}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      <Card style={{ gap: space.md }}>
        <View style={{ gap: space.sm }}>
          <Txt variant="micro" tone="secondary">
            Nom du réseau
          </Txt>
          <TextInput
            value={ssid}
            onChangeText={onSsid}
            placeholder="Le nom exact, majuscules comprises"
            placeholderTextColor={t.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Nom du réseau Wi-Fi"
            style={field}
          />
          {prefill === 'detected' && (
            <Txt variant="micro" tone="network">
              Réseau détecté — vérifiez qu’il s’agit bien du 2,4 GHz
            </Txt>
          )}
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="micro" tone="secondary">
            Mot de passe
          </Txt>
          <View style={{ justifyContent: 'center' }}>
            <TextInput
              value={password}
              onChangeText={onPassword}
              placeholder="Mot de passe du réseau"
              placeholderTextColor={t.textMuted}
              secureTextEntry={!revealed}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Mot de passe du réseau Wi-Fi"
              style={[field, { paddingRight: space.xxl }]}
            />
            {/* Révélation plutôt que double saisie : une faute de frappe ici
                ne se voit qu'après deux minutes d'attente et un échec muet. */}
            <Pressable
              onPress={onReveal}
              accessibilityRole="button"
              accessibilityLabel={revealed ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              hitSlop={12}
              style={{ position: 'absolute', right: space.md }}
            >
              {revealed ? (
                <EyeOff size={20} color={t.textSecondary} strokeWidth={iconStroke} />
              ) : (
                <Eye size={20} color={t.textSecondary} strokeWidth={iconStroke} />
              )}
            </Pressable>
          </View>
        </View>

        {/* Dire d'où viennent ces valeurs : un mot de passe déjà rempli sans
            explication laisse croire à une saisie précédente non effacée. */}
        {prefill === 'remembered' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Check size={16} color={t.success} strokeWidth={2} />
            <Txt variant="micro" tone="secondary" style={{ flex: 1 }}>
              Réseau du dernier appairage réussi — modifiez-le si besoin.
            </Txt>
          </View>
        )}
      </Card>

      <Button
        label="Lancer l’appairage"
        full
        loading={busy}
        disabled={ssid.trim().length === 0}
        onPress={onLaunch}
      />
    </View>
  );
}

// ──────────────────────────────────────────────────────────── étape 4 : appairage

function PairingStep({ progress }: { progress: 'connecting' | 'binding' }) {
  // Un décompte plutôt qu'une attente muette : sans lui, une association qui
  // traîne ne se distingue pas d'une application figée.
  const [remaining, setRemaining] = useState(135);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
        <DeviceAvatar icon={deviceIcons.plug} size={72} active tone="network" />
        <Txt variant="card">Appairage en cours</Txt>
        <Txt variant="section" tone={remaining > 20 ? 'network' : 'danger'} tight>
          {remaining} s
        </Txt>
      </Card>

      {/* Deux étapes nommées plutôt qu'une attente muette : quand ça échoue,
          savoir laquelle des deux a bloqué oriente la correction. */}
      <Card style={{ gap: space.md }}>
        <Phase
          label="L’appareil rejoint votre Wi-Fi"
          done={progress === 'binding'}
          active={progress === 'connecting'}
        />
        <Phase label="L’appareil s’associe à votre foyer" active={progress === 'binding'} />
      </Card>

      <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        Laissez l’application ouverte et restez près de l’appareil.
      </Txt>
    </View>
  );
}

// ───────────────────────────────────────────────────────────── étape 5 : trouvé

function FoundStep({
  device,
  importing,
  error,
  onAdd,
}: {
  device: { deviceId: string; name: string };
  importing: boolean;
  error: string | null;
  onAdd: () => void;
}) {
  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
        <DeviceAvatar icon={deviceIcons.plug} size={72} active />
        <Txt variant="card">Appareil appairé</Txt>
        <Txt variant="body" tone="secondary" style={{ textAlign: 'center' }}>
          {device.name || 'Appareil sans nom'}
        </Txt>
        <StatusChip label={device.deviceId} tone="online" dot={false} />
      </Card>

      {error && (
        <Card tint="danger" style={{ gap: space.sm }}>
          <Txt variant="caption">{error}</Txt>
        </Card>
      )}

      <Card style={{ gap: space.sm }}>
        <Txt variant="caption" tone="secondary">
          Il reste à le faire entrer dans votre foyer : c’est ce qui le rendra pilotable par vos
          scénarios, et par les autres membres du foyer même téléphone éteint. Vous pourrez le
          renommer et le ranger dans une pièce ensuite.
        </Txt>
      </Card>

      <Button
        label={error ? 'Réessayer' : 'Ajouter à mon foyer'}
        full
        loading={importing}
        onPress={onAdd}
      />
    </View>
  );
}

// ───────────────────────────────────────────────────────────── étape 6 : échec

function FailedStep({
  message,
  onRetry,
  onGiveUp,
}: {
  message: string;
  onRetry: () => void;
  onGiveUp: () => void;
}) {
  return (
    <View style={{ gap: space.md }}>
      <Card tint="danger" style={{ gap: space.sm }}>
        <Txt variant="bodyStrong">L’appairage n’a pas abouti</Txt>
        <Txt variant="caption" tone="secondary">
          {message}
        </Txt>
      </Card>

      {/* Les causes, par fréquence réelle. Un message d'erreur seul renvoie
          l'utilisateur à lui-même : ces quatre points couvrent l'essentiel. */}
      <Card style={{ gap: space.md }}>
        <Txt variant="bodyStrong">Ce qu’il faut vérifier</Txt>
        <Instruction index={1} text="Le réseau choisi est bien en 2,4 GHz, pas en 5 GHz." />
        <Instruction index={2} text="Le mot de passe du Wi-Fi est exact — casse comprise." />
        <Instruction index={3} text="Le Bluetooth du téléphone est actif, et l’appareil est proche." />
        <Instruction index={4} text="Le voyant clignotait rapidement au moment du lancement." />
      </Card>

      <View style={{ gap: space.sm }}>
        <Button label="Recommencer" full onPress={onRetry} />
        <Button label="Abandonner" variant="ghost" full onPress={onGiveUp} />
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────── fragments

function Instruction({ index, text }: { index: number; text: string }) {
  const t = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: radius.pill,
          backgroundColor: t.surfaceSunken,
          borderWidth: 1,
          borderColor: t.lineStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt variant="micro" tone="secondary">
          {index}
        </Txt>
      </View>
      <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

/** Étape d'appairage : faite, en cours, ou à venir — jamais par la seule couleur. */
function Phase({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  const t = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? t.networkSoft : 'transparent',
          borderWidth: 1,
          borderColor: done || active ? t.networkRing : t.lineStrong,
        }}
      >
        {done && <Check size={14} color={t.network} strokeWidth={2} />}
      </View>
      <Txt variant="caption" tone={done || active ? 'primary' : 'muted'} style={{ flex: 1 }}>
        {label}
      </Txt>
      {active && (
        <Txt variant="micro" tone="network">
          en cours
        </Txt>
      )}
    </View>
  );
}

function fieldStyle(t: ReturnType<typeof useTheme>) {
  return {
    height: 52,
    borderRadius: radius.control,
    backgroundColor: t.surfaceSunken,
    borderWidth: 1,
    borderColor: t.lineStrong,
    paddingHorizontal: space.md,
    color: t.text,
    fontFamily: font.body.regular,
    fontSize: fontSize.body,
  } as const;
}
