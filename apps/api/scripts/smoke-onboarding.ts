/**
 * Vérification bout en bout du parcours d'accueil (design system §7).
 *
 * Rejoue exactement la séquence d'appels que font les écrans, dans l'ordre :
 * inscription → foyer → association du boîtier par QR code → première pièce.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { loadEnv } from '../src/env.js';
import { createContext } from '../src/context.js';
import { buildServer } from '../src/server.js';
import { hashPassword, hashToken } from '../src/http/auth.js';

const ctx = createContext(loadEnv());
const app = await buildServer(ctx);
const json = (r: { json: () => any }) => r.json();

// — usine : un boîtier et son QR code
const serial = `DMT-ONB-${randomBytes(3).toString('hex').toUpperCase()}`;
const claimCode = randomBytes(5).toString('hex').toUpperCase();
await ctx.prisma.deviceUnit.create({
  data: {
    id: randomUUID(),
    serial,
    name: 'Boîtier domotique',
    claim: { create: { codeHash: hashToken(claimCode), expiresAt: new Date(Date.now() + 3600_000) } },
  },
});
const qr = JSON.stringify({ serial, claim_code: claimCode });
console.log('0. QR code usine     →', qr);

// — écran 2 : inscription
const email = `onb-${Date.now()}@example.com`;
const signup = json(
  await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email, password: 'un-mot-de-passe-solide', display_name: 'Camille' },
  }),
);
const auth = { authorization: `Bearer ${signup.tokens.access_token}` };
console.log('1. inscription       →', signup.user.display_name);

// L'aiguillage envoie vers l'accueil parce que le compte n'a aucun foyer.
const avant = json(await app.inject({ method: 'GET', url: '/v1/homes', headers: auth }));
console.log('2. foyers du compte  →', avant.items.length, '→ parcours d’accueil');

// — écran 3 : création du foyer
const home = json(
  await app.inject({
    method: 'POST',
    url: '/v1/homes',
    headers: auth,
    payload: { name: 'Maison des Lilas', timezone: 'Europe/Paris' },
  }),
).home;
console.log('3. foyer créé        →', home.name, '| fuseau', home.timezone);

// — écran 6 : scan du QR code
const parsed = JSON.parse(qr) as { serial: string; claim_code: string };
const claimed = await app.inject({
  method: 'POST',
  url: '/v1/devices/claim',
  headers: auth,
  payload: { serial: parsed.serial, claim_code: parsed.claim_code, home_id: home.id },
});
console.log('4. QR scanné → claim →', claimed.statusCode, '|', json(claimed).unit?.serial ?? json(claimed).error?.code);

// Un second scan du même code doit échouer : le code est à usage unique.
const rejeu = await app.inject({
  method: 'POST',
  url: '/v1/devices/claim',
  headers: auth,
  payload: { serial: parsed.serial, claim_code: parsed.claim_code, home_id: home.id },
});
console.log('5. QR rescanné       →', rejeu.statusCode, '/', json(rejeu).error.code);

// — écran 7 : confirmation
const units = json(await app.inject({ method: 'GET', url: `/v1/homes/${home.id}/units`, headers: auth }));
console.log('6. confirmation      →', units.items[0].name, '| en ligne:', units.items[0].online);

// — écran 8 : première pièce
const room = json(
  await app.inject({
    method: 'POST',
    url: `/v1/homes/${home.id}/rooms`,
    headers: auth,
    payload: { name: 'Salon', icon: 'salon', device_ids: [] },
  }),
).room;
console.log('7. première pièce    →', room.name);

// — l'application a maintenant de quoi s'afficher
const state = json(await app.inject({ method: 'GET', url: `/v1/homes/${home.id}/state`, headers: auth }));
console.log('8. tableau de bord   →', state.rooms.length, 'pièce,', state.units.length, 'boîtier,', state.devices.length, 'appareil');

await ctx.prisma.user.deleteMany({ where: { email } });
await ctx.prisma.home.deleteMany({ where: { id: home.id } });
await ctx.prisma.deviceUnit.deleteMany({ where: { serial } });
console.log('9. nettoyage         → données de test supprimées');

await app.close();
await ctx.close();
