import React, { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
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

/**
 * Appairage Wi-Fi d'un appareil, depuis l'application.
 *
 * Troisième chemin d'ajout, à côté du Zigbee et du compte tiers : ici l'appareil
 * n'existe encore nulle part, et c'est le téléphone qui lui donne le réseau.
 *
 * **Deux étapes avant de lancer**, et pas une seule. La préparation matérielle
 * (brancher, faire clignoter) et la saisie du réseau demandent deux gestes
 * différents, au deux moments différents : les réunir sur un écran fait qu'on
 * saisit son mot de passe pendant que l'appareil sort déjà de son mode
 * association, dont la fenêtre est courte.
 *
 * **Le mode AP impose de tout demander à l'avance.** Le téléphone quitte le
 * réseau du foyer pour rejoindre celui de l'appareil : une fois parti, plus
 * aucune requête ne sort. Identifiants du compte technique, jeton d'appairage,
 * foyer Tuya — `useTuyaPairing` récupère tout avant de basculer.
 *
 * L'écran ne pilote rien après l'appairage : il enchaîne sur l'import déjà
 * existant, qui fait entrer l'appareil dans le foyer côté serveur.
 */
type Step = 'prepare' | 'network';

/** Le SDK laisse cette durée à l'appareil pour rejoindre le réseau puis le compte. */
const TIMEOUT_S = 120;

export default function DevicePairWifi() {
  const t = useTheme();
  const router = useRouter();
  const { home } = useHome();
  const integrations = useIntegrations(home?.id);
  const pairing = useTuyaPairing();

  const [step, setStep] = useState<Step>('prepare');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  // D'où vient ce qui est affiché : le dire évite qu'on prenne un champ prérempli
  // pour une saisie oubliée, et qu'on ne pense pas à le vérifier.
  const [prefill, setPrefill] = useState<'none' | 'remembered' | 'detected'>('none');
  // Lue dans une promesse résolue plus tard : la valeur capturée par la fermeture
  // serait celle du rendu qui a lancé la détection.
  const ssidRef = useRef('');
  ssidRef.current = ssid;
  const [helpOpen, setHelpOpen] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Capturé dans une constante : le narrowing d'une propriété d'objet ne survit
  // pas à une fermeture, et les gestionnaires ci-dessous en ont besoin.
  const pairingState = pairing.state;
  const searching = pairingState.step === 'searching' || pairingState.step === 'preparing';

  /**
   * Préremplissage du réseau, à l'entrée de l'étape — pas au montage de l'écran :
   * la demande d'autorisation de localisation qu'il peut déclencher n'a de sens
   * qu'en regard d'un champ « nom du réseau », jamais devant les instructions de
   * branchement.
   *
   * Le réseau retenu d'un appairage précédent passe avant celui que détecte le
   * système : lui seul porte le mot de passe, et il a déjà fait ses preuves. La
   * détection ne sert qu'au tout premier appareil.
   *
   * Une saisie déjà commencée n'est jamais écrasée : on revient ici après un
   * échec, et perdre une correction manuelle rejouerait le même échec.
   */
  useEffect(() => {
    if (step !== 'network') return;
    let cancelled = false;

    void (async () => {
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
  }, [step, pairing.detectSsid, pairing.rememberedNetwork]);

  // Le décompte suit la fenêtre du SDK : il ne la pilote pas, il la donne à voir.
  // Sans lui, une recherche qui échoue ressemble à une application figée.
  useEffect(() => {
    if (!searching) return;
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [searching, countdown]);

  async function launch() {
    setImportError(null);
    setCountdown(TIMEOUT_S);
    await pairing.start(ssid.trim(), password);
  }

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
    if (searching || pairingState.step === 'failed' || pairingState.step === 'found') {
      pairing.reset();
      setStep('network');
      return;
    }
    if (step === 'network') {
      setStep('prepare');
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <ScreenHeader title="Appareil Wi-Fi" onBack={back} />

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

      {pairingState.step === 'idle' && step === 'prepare' && (
        <PrepareStep
          helpOpen={helpOpen}
          onToggleHelp={() => setHelpOpen((open) => !open)}
          onReady={() => setStep('network')}
          disabled={!pairing.isAvailable}
        />
      )}

      {pairingState.step === 'idle' && step === 'network' && (
        <NetworkStep
          ssid={ssid}
          password={password}
          revealed={revealed}
          prefill={prefill}
          onSsid={(value) => {
            setSsid(value);
            setPrefill('none');
          }}
          onPassword={(value) => {
            setPassword(value);
            setPrefill('none');
          }}
          onReveal={() => setRevealed((shown) => !shown)}
          onLaunch={launch}
          disabled={!pairing.isAvailable}
        />
      )}

      {searching && (
        <SearchingStep
          progress={pairingState.step === 'searching' ? pairingState.progress : 'connecting'}
          countdown={countdown}
          onCancel={() => {
            pairing.reset();
            setStep('network');
          }}
        />
      )}

      {pairingState.step === 'found' && (
        <FoundStep
          device={pairingState.device}
          importing={importing}
          error={importError}
          onAdd={() => addToHome(pairingState.device.deviceId)}
        />
      )}

      {pairingState.step === 'failed' && (
        <FailedStep
          message={pairingState.message}
          onRetry={() => {
            pairing.reset();
            setStep('prepare');
          }}
          onGiveUp={() => router.back()}
        />
      )}
    </Screen>
  );

  // ─────────────────────────────────────────────────────────── étape 1 : préparer

  function PrepareStep({
    helpOpen: open,
    onToggleHelp,
    onReady,
    disabled,
  }: {
    helpOpen: boolean;
    onToggleHelp: () => void;
    onReady: () => void;
    disabled?: boolean;
  }) {
    return (
      <View style={{ gap: space.md }}>
        <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
          <DeviceAvatar icon={deviceIcons.plug} size={72} tone="network" />
          <Txt variant="card">Préparez l’appareil</Txt>
          <Txt variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            Trois gestes, dans cet ordre. L’appareil doit clignoter avant de continuer.
          </Txt>
        </Card>

        <Card style={{ gap: space.md }}>
          <Instruction index={1} text="Branchez l’appareil et attendez qu’il s’allume." />
          <Instruction
            index={2}
            text="Maintenez son bouton environ 5 secondes, jusqu’à ce que le voyant clignote rapidement."
          />
          <Instruction
            index={3}
            text="Restez près de l’appareil et de votre box pendant toute l’opération."
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

        <View style={{ gap: space.sm }}>
          <Button label="Le voyant clignote" full disabled={disabled} onPress={onReady} />
          <Button
            label={open ? 'Masquer l’aide' : 'Le voyant ne clignote pas ?'}
            variant="ghost"
            full
            onPress={onToggleHelp}
          />
        </View>

        {open && (
          <Card style={{ gap: space.sm }}>
            <Txt variant="caption" tone="secondary">
              Le geste change selon les appareils. Sur la plupart des prises et ampoules, une
              pression longue de 5 secondes suffit ; certaines demandent d’éteindre puis rallumer
              trois fois de suite.
            </Txt>
            <Txt variant="caption" tone="secondary">
              Un clignotement <Txt variant="caption">lent</Txt> signifie que l’appareil attend un
              autre mode d’appairage. Refaites la manipulation jusqu’à obtenir un clignotement
              rapide.
            </Txt>
          </Card>
        )}
      </View>
    );
  }

  // ───────────────────────────────────────────────────────────── étape 2 : réseau

  function NetworkStep({
    ssid: currentSsid,
    password: currentPassword,
    revealed: shown,
    prefill: origin,
    onSsid,
    onPassword,
    onReveal,
    onLaunch,
    disabled,
  }: {
    ssid: string;
    password: string;
    revealed: boolean;
    prefill: 'none' | 'remembered' | 'detected';
    onSsid: (value: string) => void;
    onPassword: (value: string) => void;
    onReveal: () => void;
    onLaunch: () => void;
    disabled?: boolean;
  }) {
    return (
      <View style={{ gap: space.md }}>
        <Card style={{ gap: space.sm }}>
          <Txt variant="card">Votre réseau Wi-Fi</Txt>
          <Txt variant="caption" tone="secondary">
            L’appareil a besoin de ces identifiants pour rejoindre votre réseau. Ils lui sont
            transmis directement, sans passer par nos serveurs.
          </Txt>
        </Card>

        <Card style={{ gap: space.md }}>
          <View style={{ gap: space.sm }}>
            <Txt variant="micro" tone="secondary">
              Nom du réseau
            </Txt>
            <TextInput
              value={currentSsid}
              onChangeText={onSsid}
              placeholder="Le nom exact, majuscules comprises"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Nom du réseau Wi-Fi"
              style={fieldStyle()}
            />
            {origin === 'detected' && (
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
                value={currentPassword}
                onChangeText={onPassword}
                placeholder="Mot de passe du réseau"
                placeholderTextColor={t.textMuted}
                secureTextEntry={!shown}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Mot de passe du réseau Wi-Fi"
                style={[fieldStyle(), { paddingRight: space.xxl }]}
              />
              {/* Révélation plutôt que double saisie : une faute de frappe ici
                  ne se voit qu'après deux minutes d'attente et un échec muet. */}
              <Pressable
                onPress={onReveal}
                accessibilityRole="button"
                accessibilityLabel={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                hitSlop={12}
                style={{ position: 'absolute', right: space.md }}
              >
                {shown ? (
                  <EyeOff size={20} color={t.textSecondary} strokeWidth={iconStroke} />
                ) : (
                  <Eye size={20} color={t.textSecondary} strokeWidth={iconStroke} />
                )}
              </Pressable>
            </View>
          </View>

          {/* Dire d'où viennent ces valeurs : un mot de passe déjà rempli sans
              explication laisse croire à une saisie précédente non effacée. */}
          {origin === 'remembered' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Check size={16} color={t.success} strokeWidth={2} />
              <Txt variant="micro" tone="secondary" style={{ flex: 1 }}>
                Réseau du dernier appairage réussi — modifiez-le si besoin.
              </Txt>
            </View>
          )}
        </Card>

        <Card style={{ flexDirection: 'row', gap: space.md }}>
          <AlertTriangle size={20} color={t.textSecondary} strokeWidth={iconStroke} />
          <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
            Pendant l’appairage, le téléphone rejoint brièvement le réseau de l’appareil : les
            autres applications n’auront pas de connexion pendant une minute environ.
          </Txt>
        </Card>

        <Button
          label="Lancer l’appairage"
          full
          disabled={disabled || currentSsid.trim().length === 0}
          onPress={onLaunch}
        />
      </View>
    );
  }

  // ────────────────────────────────────────────────────────── étape 3 : recherche

  function SearchingStep({
    progress,
    countdown: remaining,
    onCancel,
  }: {
    progress: 'connecting' | 'binding';
    countdown: number;
    onCancel: () => void;
  }) {
    return (
      <View style={{ gap: space.md }}>
        <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
          <DeviceAvatar icon={deviceIcons.plug} size={72} active tone="network" />
          <Txt variant="card">Appairage en cours</Txt>
          <Txt variant="section" tone={remaining > 20 ? 'network' : 'danger'} tight>
            {remaining} s
          </Txt>
        </Card>

        {/* Deux étapes nommées plutôt qu'un compte à rebours seul : quand ça
            échoue, savoir laquelle des deux a bloqué oriente la correction. */}
        <Card style={{ gap: space.md }}>
          <Phase
            label="L’appareil rejoint votre Wi-Fi"
            done={progress === 'binding'}
            active={progress === 'connecting'}
          />
          <Phase label="L’appareil s’associe à votre foyer" active={progress === 'binding'} />
        </Card>

        <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          Laissez l’application ouverte et l’écran allumé.
        </Txt>

        <Button label="Annuler" variant="ghost" full onPress={onCancel} />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────── étape 4 : trouvé

  function FoundStep({
    device,
    importing: busy,
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
          loading={busy}
          onPress={onAdd}
        />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────── étape 5 : échec

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
          <Instruction
            index={3}
            text="Le voyant clignotait rapidement au moment de lancer l’appairage."
          />
          <Instruction index={4} text="L’appareil et la box sont assez proches l’un de l’autre." />
        </Card>

        <View style={{ gap: space.sm }}>
          <Button label="Recommencer" full onPress={onRetry} />
          <Button label="Abandonner" variant="ghost" full onPress={onGiveUp} />
        </View>
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────────── fragments

  function Instruction({ index, text }: { index: number; text: string }) {
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

  function fieldStyle() {
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
}
