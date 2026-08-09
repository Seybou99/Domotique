# api

Backend de la plateforme domotique (CDC backend v1.1).

```bash
cp .env.example .env          # puis renseigner DATABASE_URL / DIRECT_URL
npm run db:migrate            # crée le schéma
npm run dev                   # http://localhost:3000/v1
npm run smoke                 # vérification bout en bout : auth → foyer → commande → temps réel
npm run smoke:units           # vérification bout en bout : usine → QR code → claim → pairing
npm run smoke:automations     # vérification bout en bout : scène, planificateur, double exécution
npm run smoke:integrations    # vérification bout en bout : OAuth, chiffrement, import, alertes
npm run provision:unit        # simule le provisionnement usine d'un boîtier
npm run tuya:check            # diagnostic du connecteur Tuya
```

`docker-compose.yml` fournit PostgreSQL + Redis en local si besoin ; la base
actuellement configurée est un projet Neon.

Sans Docker, l'API démarre quand même : `REDIS_URL` vide bascule sur un store d'état et un bus
d'événements **en mémoire**. Utilisable en développement mono-instance seulement — le boot échoue
si `NODE_ENV=production` sans Redis.

## Ce qui est implémenté

| Module | État |
|---|---|
| `auth` | inscription, connexion, rafraîchissement avec rotation, déconnexion, profil |
| `homes` | liste, création, mise à jour, membres et rôles, instantané `/state` |
| `rooms` | CRUD + réordonnancement transactionnel |
| `devices` | liste filtrée, détail, mise à jour, commande idempotente, historique, consommation |
| `realtime` | WebSocket `/v1/realtime` : abonnement par foyer, rejeu par `last_event_id`, renouvellement du jeton en vol |
| `units` | boîtiers, claim par QR code, association Zigbee avec expiration automatique |
| `automations` | scénarios et scènes, planificateur multi-instances, moteur d'exécution |
| `integrations` | liaison OAuth, découverte, import, déliaison ; jetons chiffrés au repos |
| `alerts` | fil filtrable, lecture, préférences par catégorie et par appareil, jetons push |

**Les 49 routes du contrat sont servies.** Le test `couverture du contrat` le vérifie à chaque
exécution : il échoue si une route déclarée cesse d'être servie.

## Écart assumé avec le CDC §3

Le §3 recommandait « NestJS ou Express + structuration modulaire ». C'est **Fastify + composition
explicite**. Le contrat porte déjà les schémas et les descripteurs de route ; l'apport de NestJS
se réduirait donc à son conteneur d'injection, au prix des décorateurs, de `emitDecoratorMetadata`
et d'une chaîne de test à configurer. Ici les handlers sont des fonctions testables telles quelles,
et le graphe de dépendances tient dans `src/context.ts`. Le §3 autorise explicitement l'alternative.

## Comment les routes sont écrites

Aucun chemin, aucun schéma n'est retapé. `registerRoute` prend un descripteur du contrat et en
déduit la méthode, l'URL, la validation d'entrée **et la validation de sortie** :

```ts
registerRoute(app, ctx, devicesApi.get, async ({ userId, params }) => {
  const row = await access.requireDevice(userId!, params.device_id);
  return { device: await devices.toContractDevice(row) };
});
```

Une réponse non conforme au contrat est refusée avant l'envoi et journalisée — c'est là que le
filet du §12 se referme, pas dans une relecture de code.

## Décisions prises dans le schéma Prisma

- **La valeur d'une capacité n'est pas en base.** `Capability` ne porte que le schéma
  (type, bornes, unité) plus un `snapshotValue` de reprise. La valeur courante vit dans le
  `StateStore` (Redis). Un `UPDATE` par relevé de capteur saturerait PostgreSQL (§6.4).
- **`state_changes` est prévue pour être partitionnée** par mois avec rétention 90 jours. Prisma ne
  sait pas déclarer le partitionnement : la table est créée normalement, puis convertie par une
  migration SQL dédiée. Ne jamais la requêter sans borne de temps.
- **Suppressions.** Retirer une pièce ne supprime pas ses appareils (`SetNull`). Retirer un
  boîtier ou un compte tiers supprime les appareils qui en dépendent (`Cascade`) — ils n'ont plus
  de moyen d'être pilotés.
- **`third_party_accounts` stocke les tokens en `Bytes` chiffrés**, avec un `keyVersion` pour
  permettre la rotation sans tout réencrypter d'un coup. Le chiffrement applicatif reste à écrire.
- **`automation_runs` a une contrainte d'unicité `(automationId, scheduledFor)`** — c'est la clé
  d'idempotence contre la double exécution en multi-instances.
- **`RefreshToken` est une table**, pas un jeton auto-suffisant : sans elle, pas de révocation ni
  d'écran « sessions actives ». Seul le hash est stocké, et la rotation révoque l'ancien à l'usage.

## Deux bugs trouvés par le test bout en bout

`npm run smoke` a révélé deux défauts que les tests unitaires ne pouvaient pas voir :

1. **L'origine d'un changement d'état n'était pas attribuée.** Un appareil confirmant une commande
   apparaissait comme s'étant allumé tout seul, et la commande restait indéfiniment en `sent`.
   `DeviceService.resolveOrigin` corrèle désormais l'événement entrant avec la commande en attente
   (appareil, capacité, valeur, fenêtre de temporisation) : la commande passe en `acked` et
   l'historique affiche « allumé · Camille ». Cette corrélation **optimiste** est aussi la seule
   possible pour Tuya, dont les notifications de statut ne portent aucun identifiant de commande.

2. **La résolution d'appareil par `(protocole, externalId)` n'était pas fiable.** Deux foyers
   peuvent porter le même identifiant externe ; `findFirst` écrivait alors l'état dans le foyer
   d'un autre client. Les événements de connecteur transportent maintenant leur contexte
   (`deviceId`, `unitId` ou `accountId`), et le service refuse d'agir plutôt que de deviner quand
   l'ambiguïté persiste.

## Le canal temps réel

`registerRealtime` implémente les deux mécanismes que le CDC §5 promettait sans en spécifier le
support :

- **Reprise après coupure.** L'app renvoie son dernier `event_id` à l'abonnement. Si la fenêtre de
  rejeu le couvre, elle reçoit le delta ; sinon `resync_required`, et elle repart de
  `GET /v1/homes/:id/state`. Un delta vide n'est jamais renvoyé : il laisserait l'app croire
  qu'elle est à jour alors qu'elle a un état périmé.
- **Renouvellement du jeton en vol.** `auth_expiring` part 60 s avant l'échéance ; l'app répond
  `auth_refresh` sur la même socket, sans reconnexion. Sans réponse, fermeture en 4001.

Subtilité d'implémentation : on s'abonne au bus **avant** de rejouer, en mettant les événements
vivants dans un tampon, puis on écarte les doublons par `event_id`. L'ordre inverse laisserait
passer tout événement survenu pendant la lecture du delta.

Le jeton transite en paramètre de requête (l'API WebSocket standard n'accepte pas d'en-tête
personnalisé). Contrepartie assumée, et compensée : le sérialiseur de journaux du serveur rédige
`access_token`, sinon tous les jetons finiraient en clair dans les logs.

Le client `apps/mobile/src/api/realtime.ts` parle déjà ce protocole — les deux côtés dérivent du
même contrat.

## Boîtiers et association (§8)

**Le claim par QR code.** Un boîtier est créé en usine sans foyer (`homeId` nullable) avec un code
à usage unique dont seul le hash est stocké. `POST /v1/devices/claim` le rattache à un foyer, en
transaction — un boîtier associé sans que son code soit consommé pourrait être réclamé deux fois.
Le code n'est **pas** un mécanisme d'authentification : l'identité permanente du boîtier est son
certificat mTLS.

Deux protections : le message est identique pour « série inconnue » et « code faux » (les
distinguer permettrait d'énumérer les numéros de série valides), et une limitation de débit plafonne
les tentatives — sans elle, un code court serait devinable par force brute.

**L'association Zigbee.** `PairingCapable` est une extension **optionnelle** de `DeviceConnector` :
seul le Zigbee a besoin d'ouvrir temporairement son réseau, un appareil cloud tiers étant déjà
appairé chez son fabricant. La fenêtre se referme d'elle-même, sans dépendre d'une action de
l'app — exigence du §5.2, puisqu'un réseau Zigbee laissé ouvert accepte n'importe quel appareil à
portée.

Les sessions vivent dans le `PairingStore` (Redis en production), pas en base : elles durent
60 secondes et n'ont pas à survivre à un redémarrage.

## Automatisations (§11)

**Le point critique, c'est la double exécution.** Le backend est stateless et répliqué : un
planificateur naïf exécuterait « Bonne nuit à 23:30 » une fois par instance — trois volées de
commandes, trois lignes d'historique, trois fois le quota Tuya.

La protection ne repose pas sur un verrou applicatif mais sur la contrainte d'unicité
`(automationId, scheduledFor)` : chaque instance tente d'insérer l'exécution, une seule y parvient,
les autres reçoivent une violation de contrainte et passent leur tour. C'est le seul mécanisme qui
reste correct si une instance se fige entre la prise du verrou et l'exécution.
`npm run smoke:automations` lance deux instances sur la même échéance et vérifie qu'une seule
exécute.

**Les horaires sont calculés dans le fuseau du foyer**, pas en UTC. « 23:30 » à Paris tombe à 21:30
ou 22:30 UTC selon la saison : un planificateur en UTC dériverait d'une heure deux fois par an, et
personne ne ferait le lien avec le changement d'heure. Les cas limites sont testés, y compris
l'heure qui **n'existe pas** la nuit du passage à l'heure d'été — 02:30 le 29 mars n'est jamais
déclenché plutôt que décalé à une heure que l'utilisateur n'a pas choisie.

**Le résumé en langage naturel** (écran 3.5) est produit par le serveur. C'est lui qui exécute,
donc lui seul peut garantir que la phrase décrit ce qui se passera. Si l'app le reconstruisait,
elle réimplémenterait la logique des déclencheurs et les deux versions divergeraient.

**Un lancement manuel n'évalue pas les conditions** : c'est une intention explicite de
l'utilisateur, pas un déclenchement automatique. Il est idempotent sur `run_id`, un double appui ne
lance pas la scène deux fois.

Non implémenté : les déclencheurs et conditions de **présence**, faute de source de données. La
condition répond « non satisfait » plutôt que de déclencher sur une information qu'on n'a pas.

## Comptes tiers (§6.2, §7)

**Les jetons sont chiffrés au repos** en AES-256-GCM — qui chiffre *et* authentifie : une
altération du chiffré en base fait échouer le déchiffrement au lieu de passer inaperçue. Le format
stocké porte sa version de clé, ce qui permet une **rotation** sans réencrypter tout d'un coup :
`TOKEN_ENCRYPTION_KEY="1:ancienne=,2:nouvelle="` chiffre avec la version 2 et déchiffre les deux.
La clé est validée au démarrage, pas à la première liaison de compte.

**Aucun jeton ne franchit le contrat.** Le schéma `thirdPartyAccount` n'en déclare aucun, donc la
validation de sortie les retirerait même si une requête les incluait par erreur.

**L'état OAuth est à usage unique** et lie l'URL d'autorisation au foyer *et* à l'utilisateur qui
l'a demandée. Sans cela, un tiers pourrait faire compléter le flux par la victime et rattacher son
compte au foyer de l'attaquant.

En développement, un **fournisseur simulé** est enregistré sous `hue` — dont le connecteur réel
arrive en V2. Le parcours complet (autorisation → échange → découverte → import) est ainsi
testable sans dépendre d'un tiers, et sans qu'un faux compte puisse passer pour un vrai compte
Tuya. Le fournisseur Tuya réel est écrit mais **non éprouvé contre un compte réel** : les appels
restent bloqués tant que l'IP sortante n'est pas autorisée sur le projet cloud.

## Travail asynchrone et robustesse

Trois gestionnaires tournent hors requête HTTP : le flux d'état des connecteurs, les découvertes
d'association, et les déclencheurs par capteur. Une exception dans l'un d'eux se transforme en
rejet non capturé, ce qui **arrête le processus Node** — un appareil supprimé pendant qu'une
confirmation est en vol suffisait à faire tomber le serveur entier. Les trois sont désormais
protégés, et `main.ts` pose un filet `unhandledRejection` qui journalise au lieu de tomber.

Règle à tenir : tout `void promesse` ou tout gestionnaire `async` hors requête doit avoir son
`catch`.

## Connecteur Tuya

`src/devices/tuya/` contient maintenant les deux moitiés, volontairement séparées :

| | Rôle |
|---|---|
| `TuyaProvider` | relie un compte, énumère ses appareils, renouvelle les jetons |
| `TuyaConnector` | envoie les commandes, lit et suit l'état des appareils |

Tuya joue les deux rôles, Zigbee seulement le second. Les fusionner obligerait le connecteur
Zigbee à porter des méthodes OAuth vides.

**`ackSemantics: 'gateway'`.** Un `HTTP 200` de Tuya signifie « le cloud a pris la commande »,
jamais « la prise s'est allumée ». La confirmation réelle arrive plus tard, sans identifiant de
commande — c'est la corrélation optimiste de `DeviceService` qui les rapproche. Sans cette
déclaration, une commande Tuya passerait en `acked` alors que rien n'a bougé.

**Les échelles viennent de l'appareil, pas d'une supposition.** Le connecteur lit
`/v1.0/devices/{id}/specifications` et met les bornes en cache. Deviner « 10-1000 » est vrai pour
`bright_value_v2` et faux pour les modèles anciens en 25-255 : une lampe à mi-course s'afficherait
à 4 %.

**Le suivi d'état est en scrutation, transitoire, et éteint par défaut.** Le §6.2 demande de
s'abonner au service de notification de statut — un flux Pulsar qui demande un client dédié. En
attendant, la scrutation existe (`TUYA_POLL_INTERVAL_S`, 0 = désactivée) mais reste éteinte : sur
l'essai gratuit Tuya, le pack de ressources plafonne à **0,20 USD par mois**, et une lecture toutes
les 30 s représente 2 880 appels par jour et par appareil. `onStateChange` est conçu pour que le
passage à Pulsar ne change rien au reste du système.

**Un budget d'appels plafonne la consommation** (§6.5). Le quota d'un projet Tuya est global à tous
les foyers : sans plafond, une automatisation emballée chez un client consommerait le budget de
toute la plateforme. `CallBudget` applique une limite par compte lié **et** une limite globale,
vérifiée en premier. Une action utilisateur reçoit `connector_quota_exceeded` avec son délai
d'attente ; la scrutation, elle, saute simplement son tour — personne n'attend de réponse.

**Ce qui n'a jamais tourné contre un appareil réel** : tout ce qui précède. L'authentification du
projet est vérifiée, la conversion d'échelle est testée, mais aucune commande n'a encore atteint
une prise.

## Deux vérifications distinctes côté Tuya

`npm run tuya:check` teste **l'authentification** et **l'accès aux appareils** séparément, parce
qu'ils échouent indépendamment : l'obtention du jeton ne consomme pas le pack de ressources et
réussit même quand l'abonnement au service est suspendu. Un diagnostic qui s'arrête au jeton
annonce « tout va bien » alors qu'aucun appel sur un appareil ne passera.

## Le piège du centre de données Tuya

La console affiche « Western Europe Data Center », mais l'endpoint correspondant est
`openapi-weaz.tuyaeu.com`, **pas** `openapi.tuyaeu.com`. Le mauvais endpoint renvoie :

```
1114 : your ip(88.162.10.55) don't have access to this API
```

Un message qui parle d'adresse IP alors que la cause est régionale — on peut y passer des heures à
configurer une allowlist qui n'y est pour rien. Vérifié en conditions réelles : le même projet, la
même IP, le même secret, renvoient `1114` sur un endpoint et un jeton valide sur l'autre.

`npm run tuya:check` balaie désormais les six centres et indique lequel répond.

## Ce qui n'existe pas encore

- Connecteurs réels. Seul `SimulatedConnector` est enregistré (désactivé en production) : il
  confirme les commandes de façon asynchrone, ce qui suffit à valider la boucle
  commande → événement → interface sans matériel.
- Envoi effectif des notifications push : les jetons sont collectés et les préférences stockées,
  mais rien n'appelle encore APNs ni FCM.
- Budget d'appels Tuya (§6.5), présence, connecteur Zigbee/MQTT réel.
- Le fournisseur Tuya s'authentifie désormais pour de bon, mais n'a jamais joint un **compte
  utilisateur** réel (liaison OAuth, énumération d'appareils) — il faut un compte Smart Life avec
  au moins un appareil.
- Le **connecteur** Tuya (envoi de commandes, réception des changements d'état) reste à écrire :
  seul le fournisseur existe.
- La limitation de débit n'est posée que sur le claim ; elle reste à généraliser aux autres routes.
