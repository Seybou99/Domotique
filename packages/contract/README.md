# @domotique/contract

Contrat partagé entre le backend et l'application (CDC backend §12), en version `v1`.

Le backend valide ses entrées **et ses sorties** avec ces schémas ; l'app en dérive ses types et
son client HTTP. Un champ propre à Tuya qui s'échapperait d'un connecteur est arrêté à la
sérialisation, pas en relecture de code.

```bash
npm run build --workspace @domotique/contract
npm run test  --workspace @domotique/contract
```

## Contenu

```
src/primitives.ts        version d'API, pagination, codes d'erreur
src/domain/capability.ts capacités : schéma, valeur normalisée, origine d'un changement
src/domain/home.ts       foyer, membres et rôles, pièces
src/domain/device.ts     appareil, provenance, boîtier, session de pairing
src/domain/command.ts    commande idempotente et sémantique d'accusé de réception
src/domain/automation.ts déclencheurs, conditions, actions, journal d'exécution
src/domain/alert.ts      alertes, préférences de notification, jetons push
src/domain/thirdParty.ts comptes tiers (sans jamais aucun token)
src/rest/endpoints.ts    registre des routes REST
src/ws/events.ts         canal temps réel
```

## Quatre garanties que ce paquet apporte

**1. Les valeurs sont normalisées.** Une luminosité vaut 0-100 partout. Tuya expose 0-1000 et
Zigbee 0-254 : la conversion est la responsabilité du connecteur, et une échelle native qui
franchit la frontière est rejetée par la validation. Un test le vérifie.

**2. Aucun token ne peut fuir.** `thirdPartyAccount` ne déclare ni `access_token` ni
`refresh_token`. Comme Zod retire les clés non déclarées, une réponse mal construite les perd au
lieu de les transmettre.

**3. Les routes sont des données, pas des chaînes.** `buildPath(devices.get, { device_id })`
produit `/v1/devices/…`, avec les valeurs encodées. Aucune URL n'est écrite à la main dans l'app,
et une route absente du registre ne compile pas.

**4. L'API est versionnée dès maintenant.** Une app mobile ne se met pas à jour de force : les
versions installées continueront d'être servies sur `/v1` quand `/v2` apparaîtra.

## Points où le contrat va plus loin que le CDC v1.1

Trois manques relevés à la relecture ont été comblés directement dans les schémas :

- **Origine d'un changement d'état** (`changeOrigin`). L'écran 2.2 affiche « allumé · app » et
  « scène Soirée cinéma », mais aucune entité ne portait l'information. Elle est désormais
  obligatoire sur `device_state_changed` et sur l'historique.
- **Sémantique d'accusé de réception** (`ackSemantics`). `acked` ne peut pas signifier la même
  chose pour Zigbee (confirmé par l'appareil) et pour Tuya (accepté par le cloud). Chaque
  commande porte donc sa sémantique et son `timeout_ms`, propres au connecteur.
- **`Home.timezone`.** « Chaque soir à 23:30 » n'a aucun sens côté serveur sans fuseau. Le champ
  est requis, et `automationRun.scheduled_for` sert de clé d'idempotence contre la double
  exécution en multi-instances.

## Ce que le contrat impose au backend

- Le canal temps réel doit conserver une **fenêtre d'événements** (Redis Stream avec `MAXLEN`) :
  `last_event_id` ne peut rien rejouer au-dessus d'un Pub/Sub, qui ne garde rien.
- `POST /v1/devices/:id/command` doit être **idempotent sur `command_id`** : rejouer la même
  requête renvoie la commande existante, sans second allumage.
- Le résumé en langage naturel d'une automatisation (`summary`, écran 3.5) est produit par le
  serveur, pour rester cohérent avec l'exécution réelle.
