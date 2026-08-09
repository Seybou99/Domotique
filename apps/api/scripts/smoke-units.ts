/**
 * Vérification bout en bout du module `units` (CDC §8.2 et §8.3).
 * Provisionnement usine → claim par QR code → association Zigbee.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnv } from '../src/env.js';
import { createContext } from '../src/context.js';
import { buildServer } from '../src/server.js';
import { hashToken } from '../src/http/auth.js';

const ctx = createContext(loadEnv());
ctx.devices.start();
ctx.pairing.start();
const app = await buildServer(ctx);
const json = (r: { json: () => any }) => r.json();

const email = `units-${Date.now()}@example.com`;
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

// — usine
const serial = `DMT-TEST-${randomBytes(4).toString('hex').toUpperCase()}`;
const claimCode = randomBytes(6).toString('hex').toUpperCase();
const unit = await ctx.prisma.deviceUnit.create({
  data: {
    id: randomUUID(),
    serial,
    name: 'Boîtier domotique',
    claim: {
      create: { codeHash: hashToken(claimCode), expiresAt: new Date(Date.now() + 3600_000) },
    },
  },
});
console.log('1. provisionné usine →', serial, '| foyer:', unit.homeId ?? 'aucun');

const claim = (code: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    headers: auth,
    payload: { serial, claim_code: code, home_id: home.id, name: 'Boîtier salon' },
  });

const mauvais = await claim('MAUVAISCODE1');
console.log('2. code faux         → statut', mauvais.statusCode, '/', json(mauvais).error.code);

const claimed = json(await claim(claimCode));
console.log('3. claim             →', claimed.unit.name, '| série:', claimed.unit.serial);

const rejeu = await claim(claimCode);
console.log('4. code rejoué       → statut', rejeu.statusCode, '/', json(rejeu).error.code);

const listed = json(
  await app.inject({ method: 'GET', url: `/v1/homes/${home.id}/units`, headers: auth }),
);
console.log('5. liste des boîtiers→', listed.items.length, '| en ligne:', listed.items[0].online);

// — association Zigbee : le boîtier doit être en ligne
const horsLigne = await app.inject({
  method: 'POST',
  url: `/v1/units/${claimed.unit.id}/pairing`,
  headers: auth,
  payload: { duration_s: 60 },
});
console.log('6. pairing hors ligne→ statut', horsLigne.statusCode, '/', json(horsLigne).error.code);

await ctx.prisma.deviceUnit.update({ where: { id: claimed.unit.id }, data: { online: true } });

const session = json(
  await app.inject({
    method: 'POST',
    url: `/v1/units/${claimed.unit.id}/pairing`,
    headers: auth,
    payload: { duration_s: 60 },
  }),
).session;
console.log('7. pairing ouvert    → expire à', session.expires_at.slice(11, 19));

// Le connecteur simulé fait remonter un appareil peu après l'ouverture.
await new Promise((r) => setTimeout(r, 500));
const found = await ctx.pairing.status(claimed.unit.id);
console.log('8. appareil détecté  →', found?.discovered[0]?.suggested_name ?? 'aucun',
  '|', found?.discovered[0]?.external_id ?? '');

const stopped = await app.inject({
  method: 'DELETE',
  url: `/v1/units/${claimed.unit.id}/pairing`,
  headers: auth,
});
console.log('9. pairing fermé     → statut', stopped.statusCode,
  '| session:', (await ctx.pairing.status(claimed.unit.id)) === null ? 'close' : 'encore ouverte');

const removed = await app.inject({
  method: 'DELETE',
  url: `/v1/units/${claimed.unit.id}`,
  headers: auth,
  payload: { devices: 'delete' },
});
console.log('10. retrait boîtier  → statut', removed.statusCode);

await ctx.prisma.user.deleteMany({ where: { email } });
await ctx.prisma.home.deleteMany({ where: { id: home.id } });
await ctx.prisma.deviceUnit.deleteMany({ where: { serial } });
console.log('11. nettoyage        → données de test supprimées');

await app.close();
await ctx.close();
