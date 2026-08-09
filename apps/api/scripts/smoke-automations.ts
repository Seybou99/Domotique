/**
 * Vérification bout en bout du module `automations`.
 *
 * Le test qui compte : deux instances de backend balaient la même échéance en
 * parallèle. Une seule doit exécuter.
 */
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../src/env.js';
import { createContext } from '../src/context.js';
import { buildServer } from '../src/server.js';

const env = loadEnv();
const ctx = createContext(env);
ctx.devices.start();
const app = await buildServer(ctx);
const json = (r: { json: () => any }) => r.json();

const email = `auto-${Date.now()}@example.com`;
const signup = json(
  await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email, password: 'un-mot-de-passe-solide', display_name: 'Camille' },
  }),
);
const auth = { authorization: `Bearer ${signup.tokens.access_token}` };
const home = json(
  await app.inject({
    method: 'POST',
    url: '/v1/homes',
    headers: auth,
    payload: { name: 'Maison des Lilas', timezone: 'Europe/Paris' },
  }),
).home;

const device = await ctx.prisma.device.create({
  data: {
    homeId: home.id,
    name: 'Plafonnier',
    kind: 'light',
    protocol: 'zigbee',
    externalId: `0x${randomUUID().slice(0, 7)}`,
    online: true,
    capabilities: { create: [{ type: 'on_off', writable: true }] },
  },
});

// — création d'une scène (déclencheur manuel)
const scene = json(
  await app.inject({
    method: 'POST',
    url: `/v1/homes/${home.id}/automations`,
    headers: auth,
    payload: {
      name: 'Soirée cinéma',
      icon: 'cinema',
      trigger: { kind: 'manual' },
      conditions: [],
      actions: [{ kind: 'set', device_id: device.id, target: { type: 'on_off', value: true } }],
      enabled: true,
    },
  }),
).automation;
console.log('1. scène créée       →', scene.name);
console.log('2. résumé serveur    →', scene.summary);

// — un appareil d'un autre foyer doit être refusé
const autreFoyer = json(
  await app.inject({
    method: 'POST',
    url: '/v1/homes',
    headers: auth,
    payload: { name: 'Autre', timezone: 'Europe/Paris' },
  }),
).home;
const refus = await app.inject({
  method: 'POST',
  url: `/v1/homes/${autreFoyer.id}/automations`,
  headers: auth,
  payload: {
    name: 'Tentative',
    icon: 'nuit',
    trigger: { kind: 'manual' },
    conditions: [],
    actions: [{ kind: 'set', device_id: device.id, target: { type: 'on_off', value: true } }],
    enabled: true,
  },
});
console.log('3. appareil étranger →', refus.statusCode, '/', json(refus).error.code);

// — lancement manuel, puis rejeu du même run_id
const runId = randomUUID();
const lancer = () =>
  app.inject({
    method: 'POST',
    url: `/v1/automations/${scene.id}/run`,
    headers: auth,
    payload: { run_id: runId },
  });
const premier = json(await lancer()).run;
console.log('4. lancement         →', premier.status, '| appareils en échec:', premier.failed_device_ids.length);
const rejeu = json(await lancer()).run;
console.log('5. rejeu même run_id →', rejeu.id === premier.id ? 'idempotent' : 'ÉCHEC : doublon');

// — planification : une échéance il y a une minute, deux instances en parallèle
const scheduled = await ctx.prisma.automation.create({
  data: {
    homeId: home.id,
    name: 'Bonne nuit',
    icon: 'nuit',
    triggerKind: 'schedule',
    trigger: { kind: 'schedule', at: heureLocaleIlYAUneMinute(), weekdays: [] },
    conditions: [],
    actions: [{ kind: 'set', device_id: device.id, target: { type: 'on_off', value: false } }],
    enabled: true,
  },
});
console.log('6. scénario planifié →', (scheduled.trigger as { at: string }).at, '(heure de Paris)');

// Deuxième contexte = seconde instance de backend, même base.
const ctx2 = createContext(env);
const now = new Date();
// Fenêtre volontairement large : on vise une échéance passée d'une minute.
const depuis = new Date(now.getTime() - 5 * 60_000);
const [a, b] = await Promise.all([
  ctx.scheduler.tick(now, depuis),
  ctx2.scheduler.tick(now, depuis),
]);
console.log('7. deux instances    → instance A a exécuté', a, '| instance B a exécuté', b);

const runs = await ctx.prisma.automationRun.count({ where: { automationId: scheduled.id } });
console.log('8. exécutions en base→', runs,
  runs === 1 ? '(une seule — correct)' : runs === 0 ? '(AUCUNE — échéance ratée)' : '(DOUBLON !)');

const history = json(
  await app.inject({ method: 'GET', url: `/v1/automations/${scene.id}/history`, headers: auth }),
);
console.log('9. historique        →', history.items.length, 'exécution(s), statut:', history.items[0]?.status);

// Les confirmations du connecteur arrivent de façon asynchrone : on les laisse
// se poser avant de supprimer les données, sinon on teste un cas de course
// plutôt que le module.
await new Promise((r) => setTimeout(r, 600));

await ctx.prisma.user.deleteMany({ where: { email } });
await ctx.prisma.home.deleteMany({ where: { id: { in: [home.id, autreFoyer.id] } } });
console.log('10. nettoyage        → données de test supprimées');

await app.close();
await ctx.close();
await ctx2.close();

/** « HH:MM » à Paris, il y a une minute — pour tomber dans la fenêtre de rattrapage. */
function heureLocaleIlYAUneMinute(): string {
  const instant = new Date(Date.now() - 60_000);
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}
