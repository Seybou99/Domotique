# Design system — « Veille active »

Implémentation React Native du design system décrit dans `design-system-domotique.docx` v1.0,
calée sur les maquettes `App Domotique-selection`.

```bash
npm start          # puis « i » pour iOS, « a » pour Android
npx tsc --noEmit   # vérification de types
```

La galerie du design system a déménagé dans `app/design-system.tsx` : tous les composants, tous
leurs états, et un bouton pour basculer sombre / clair. On y accède depuis l'onglet Profil.
L'application affiche désormais les vrais écrans, branchés sur le backend.

## Organisation

```
src/theme/tokens.ts        valeurs brutes (couleurs, espacements, rayons, typo, mouvement)
src/theme/theme.ts         rôles sémantiques + tables sombre / clair
src/theme/ThemeProvider.tsx
src/lib/icons.tsx          correspondance type d'objet → icône Lucide
src/components/            composants, exportés par src/components/index.ts
```

**Règle unique à tenir** : un composant ne lit jamais `palette` ni une couleur en dur.
Il passe par `useTheme()` et les rôles (`energy`, `network`, `surface`, `track`…). C'est ce qui
rend le mode clair (prévu V2) purement additif : une seconde table dans `theme.ts`, zéro
modification de composant.

## Décisions prises, à valider

Quatre écarts assumés par rapport aux documents. Ils sont volontaires ; si l'un ne convient pas,
c'est le moment de le dire.

**1. Rampe de surfaces.** Le doc ne définit qu'une surface élevée (Slate `#3A4553`), mais les
maquettes en utilisent trois, nettement plus sombres. On a formalisé `surface` `#1C242E`,
`surfaceRaised` `#232D39`, `surfaceSunken` `#10161D`, et Slate est devenu la couleur des pistes
de curseur, bordures et états inactifs — c'est bien son rôle dans les maquettes.

**2. La navigation n'utilise pas les accents.** L'onglet actif est blanc, pas ambre. Les deux
accents encodent une information produit (énergie / réseau) ; les employer pour de la navigation
les viderait de leur sens. Seul le badge d'alerte reste rouge, parce qu'il porte une vraie
information.

**3. Squelettes de chargement statiques.** Le doc §14 demande des squelettes, et le doc §5 dit que
le breathing ring est le seul élément animé en continu. Les deux sont incompatibles avec un
squelette à effet de balayage : nos squelettes ne clignotent pas.

**4. Titres tronqués corrigés.** Les maquettes montrent « Maison des Lilas » et « Départ » coupés.
`ScreenHeader` réduit la taille de police plutôt que de tronquer, et les libellés de tuile passent
sur deux lignes.

## Le breathing ring

`BreathingRing` est la signature du produit et le **seul** élément animé en continu. Trois états :

| État | Rendu |
|---|---|
| actif + en ligne | anneau plein + halo qui respire, 3 s/cycle |
| en ligne, inactif | anneau discret, immobile |
| hors ligne | anneau gris, aucune pulsation |

Il respecte le réglage système « réduire les animations » : la pulsation devient un anneau fixe.
Aucune information n'est portée par la seule animation — le statut est toujours doublé d'un
libellé (doc §15).

**À ne pas faire** : ajouter une autre boucle d'animation ailleurs dans l'app. Le caractère unique
de ce mouvement est ce qui le rend lisible.

## Optimisme et latence

Doc §5 : *« le changement visuel doit précéder la confirmation réseau »*. Les contrôles sont donc
pilotés par l'état optimiste de l'appelant :

- `Toggle` bascule immédiatement ; passer `pending` au-delà de 400 ms sans confirmation (le seuil
  est dans `motion.pendingThreshold`) désature discrètement la piste, sans revenir en arrière.
- `LevelSlider` / `VerticalLevelSlider` exposent `onChange` (continu, pour l'affichage) et
  `onCommit` (au relâchement). **C'est `onCommit` qui doit déclencher l'appel réseau**, jamais
  `onChange` — sinon un glissement envoie 60 commandes à l'appareil.

## Accessibilité

Tenu par construction : cibles de 44 px minimum (`HIT_SLOP_MIN`, avec `hitSlop` de compensation
sur les contrôles plus petits), rôles ARIA (`switch`, `adjustable`, `tab`), libellés obligatoires
dans les signatures des composants interactifs, et statut jamais codé par la seule couleur —
`StatusChip` impose un `label`.

**Reste à vérifier avant la V1** : le contraste réel des accents sur `surfaceRaised` (le doc n'a
vérifié que le texte secondaire sur le fond principal), et un passage complet au lecteur d'écran
sur les écrans de pairing.

## Polices

Space Grotesk (display), Inter (texte), JetBrains Mono (données), importées **par sous-chemin**
dans `app/_layout.tsx`. Importer depuis la racine du paquet embarquerait les 18 graisses d'Inter
dans le binaire — on n'embarque que les 7 fichiers de la charte (~1,4 Mo au lieu de ~7 Mo).

## Ce qui n'est pas encore fait

- Composants d'onboarding (9 écrans) : scan de QR code, sélection Wi-Fi, instructions illustrées.
- Feuille modale de contrôle rapide (écran 1.3) — le contenu existe, le conteneur non.
- Graphique de consommation (écran 2.2) — l'endpoint `/devices/:id/energy` existe côté backend.
- Éditeur de scénario (écrans 3.2 à 3.5) : la liste et le lancement sont branchés, pas la création.
- Écrans de gestion : membres du foyer, comptes connectés, réglages de notifications.

## Appairage natif Tuya

`modules/tuya-pairing/` — module Expo local, iOS (Swift) et Android (Kotlin).

**Le SDK ne sert qu'à l'appairage.** Il sait aussi piloter les appareils, et on
ne s'en sert pas : si l'application commandait, un scénario programmé à 23:30 ne
partirait pas téléphone éteint, et un autre membre du foyer ne pourrait pas
piloter ce que ce téléphone a appairé. Une fois appairé, l'appareil devient
visible du projet cloud et c'est le backend qui le commande — avec le connecteur
Tuya déjà en place. Le pont natif se limite donc à cinq méthodes et trois
événements.

**Mode AP plutôt que EZ.** L'appareil expose son propre point d'accès et le
téléphone lui transmet les identifiants Wi-Fi. Le mode EZ diffuse en multicast,
que de plus en plus de routeurs bloquent : plus d'échecs pour deux manipulations
de moins.

**Le compte technique vient du serveur.** Le SDK exige un compte utilisateur
Tuya pour appairer. `POST /v1/integrations/tuya/app-credentials` l'émet et le
conserve : généré sur l'appareil, une réinstallation en créerait un nouveau et
les appareils déjà appairés deviendraient invisibles.

**Tout passe par le plugin de configuration.** `expo prebuild` régénère `ios/` et
`android/` et écrase les modifications manuelles ; `plugins/withTuya.js` est la
seule façon de garder une configuration native reproductible.

Le module est absent d'Expo Go : `isAvailable` permet à l'interface de le dire
proprement au lieu de planter.

**L'écran est `app/device-pair-wifi.tsx`**, atteint depuis la troisième carte de
`device-add`. Cinq états : préparer l'appareil, saisir le réseau, chercher,
trouvé, échoué. Deux écrans avant le lancement plutôt qu'un seul — la fenêtre
d'association est courte, et on ne veut pas la voir se refermer pendant la saisie
du mot de passe. L'étape de recherche nomme ses deux phases (rejoindre le Wi-Fi,
s'associer au foyer) : quand ça échoue, savoir laquelle a bloqué oriente la
correction. L'écran d'échec liste les causes par fréquence réelle, le 2,4 GHz en
tête.

**Le réseau ne se saisit qu'une fois.** iOS ne communique jamais le mot de passe
Wi-Fi à une application : le seul moyen d'éviter de le ressaisir à chaque
appareil est de le retenir. `src/api/wifiCredentials.ts` le conserve dans le
trousseau, aux côtés des jetons de session, et l'efface à la déconnexion.
L'enregistrement n'a lieu qu'à l'appairage **réussi** — le graver au lancement
figerait une faute de frappe, que la tentative suivante rejouerait. Le réseau
retenu prime sur celui que détecte le système : lui seul porte le mot de passe.
