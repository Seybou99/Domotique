# Plateforme domotique — monorepo

```
apps/mobile/          application React Native (Expo SDK 57) + design system « Veille active »
apps/api/             backend Fastify + Prisma + Redis
packages/contract/    contrat partagé backend ↔ app (Zod, v1)
```

Les cahiers des charges (`cahier-des-charges-domotique.docx`,
`cahier-des-charges-backend-v1.1.docx`, `design-system-domotique.docx`) et les maquettes
restent à la racine.

## Démarrer

```bash
npm install                # installe tous les workspaces
npm run build              # compile @domotique/contract (requis avant de lancer l'app)
npm run test               # tests du contrat
npm run typecheck          # vérifie contrat + app
npm run mobile             # lance Expo, puis « i » pour iOS
npm run api                # lance le backend sur http://localhost:3000/v1
npm run seed --workspace api   # crée le foyer de démonstration
```

Ordre de démarrage : `npm run build`, puis le backend, puis l'app. Le bouton
« Compte de démonstration » de l'écran de connexion (visible en développement seulement) ouvre
directement le foyer créé par le seed.

Le backend a besoin de PostgreSQL et Redis : `cd apps/api && docker compose up -d`, puis
`npm run db:migrate`. Sans Redis, il démarre en mode mémoire mono-instance (développement seulement).

Le paquet `contract` est consommé depuis `dist/` : après une modification de ses schémas,
relancer `npm run build` avant de recharger l'app.

## Où en est le projet

| Brique | État |
|---|---|
| Design system (tokens, 19 composants, mode clair) | Fait — voir [apps/mobile/DESIGN-SYSTEM.md](apps/mobile/DESIGN-SYSTEM.md) |
| Contrat REST v1 + événements temps réel | Fait — voir [packages/contract/README.md](packages/contract/README.md) |
| Client HTTP et client temps réel côté app | Fait (`apps/mobile/src/api/`), non branchés sur un backend |
| Backend — auth, foyers, pièces, appareils | Fait — voir [apps/api/README.md](apps/api/README.md) |
| Backend — boîtiers, intégrations, scénarios, alertes | Déclarés au contrat, non implémentés (24 routes) |
| Backend — WebSocket temps réel `/v1/realtime` | Fait |
| Backend — connecteur Tuya (signature validée en réel) | Signature + client + mapping faits ; liaison de compte à écrire |
| Backend — connecteur Zigbee/MQTT, push | Pas commencés |
| Écrans produit branchés sur l'API | Connexion, tableau de bord, pièce, appareils, détail, scénarios, alertes, profil |
| CRUD dans l'app | Pièces (créer / modifier / supprimer), ajout d'appareil (Zigbee et compte tiers), scénarios (créer / modifier / supprimer) |
| Écrans produit restants | Onboarding (9 écrans), gestion des membres, réglages de notifications, graphique de consommation |

## Comment l'app parle au backend

`apps/mobile/src/api/` contient toute la couche de données :

| Fichier | Rôle |
|---|---|
| `client.ts` | client HTTP dérivé du contrat — aucune URL écrite à la main |
| `session.tsx` | jetons dans le trousseau de l'appareil, renouvellement mutualisé |
| `hooks.ts` | requêtes et mutations, avec mise à jour optimiste des commandes |
| `RealtimeProvider.tsx` | applique les événements WebSocket au cache, en place |
| `adapters.ts` | traduit un `Device` du contrat en props du design system |

**Une seule requête porte l'essentiel** : `GET /v1/homes/:id/state` renvoie foyer, pièces,
appareils et boîtiers en un appel, et sert aussi de point de reprise au temps réel. Une seule
source de vérité, un seul chemin de synchronisation.

**Les événements mettent à jour le cache en place** plutôt que de tout recharger : un relevé de
capteur ne doit pas provoquer une requête ni faire clignoter l'écran.

**Les commandes sont optimistes** (design system §5) : la valeur est écrite dans le cache avant
l'appel, restaurée si le serveur refuse, et confirmée par le canal temps réel — c'est lui qui fait
autorité.

## Les trois parcours de gestion

| Parcours | Écran | Entrée |
|---|---|---|
| **Pièces** | `app/room-form.tsx` | Tableau de bord → « Ajouter » ; détail de pièce → crayon |
| **Appareils** | `app/device-add.tsx` | Onglet Appareils → « + » |
| **Scénarios** | `app/scenario-form.tsx` | Onglet Scénarios → « + » ; appui sur un scénario pour le modifier |

Création et modification partagent le même écran, distinguées par un paramètre `?id=`. Deux écrans
quasi identiques divergeraient à la première évolution du formulaire.

**Ajouter un appareil n'est pas un formulaire.** Un appareil n'existe pas parce qu'on le saisit :
il existe parce qu'il s'est déclaré. D'où deux chemins, présentés comme des cartes égales — la
fenêtre d'association Zigbee (le boîtier ouvre son réseau 60 s, l'appareil se manifeste, on le
nomme), ou la liaison d'un compte tiers puis l'import. Ce ne sont pas deux façons d'ajouter le
même appareil : le matériel décide.

La liaison de compte passe par `WebBrowser.openAuthSessionAsync` — la session d'authentification
du système — plutôt que par une WebView embarquée : l'utilisateur voit la vraie barre d'URL du
fournisseur, et l'app n'a jamais accès à ce qu'il y saisit. L'URL de redirection est configurable
côté backend (`OAUTH_REDIRECT_URI`) : le schéma de l'app en développement, l'URL déclarée chez le
fournisseur en production.

## Le fil rouge

L'app est un **client léger** : elle ne parle qu'au backend, jamais à Tuya, Hue ou à un appareil.
Le paquet `contract` rend ce principe vérifiable par le compilateur plutôt que documentaire — un
champ propre à un écosystème tiers ne peut pas franchir la frontière sans faire échouer la
validation.

L'app ne contient donc **aucun secret**. Seule `EXPO_PUBLIC_API_URL` a sa place dans
`apps/mobile/.env` : toute variable préfixée `EXPO_PUBLIC_` est inlinée en clair dans le bundle.
