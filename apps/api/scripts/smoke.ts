/** Vérification bout en bout contre la vraie base Neon. */
import { loadEnv } from '../src/env.js';
import { createContext } from '../src/context.js';
import { buildServer } from '../src/server.js';
import { randomUUID } from 'node:crypto';

const ctx = createContext(loadEnv());
const created: string[] = [];
ctx.devices.start();
const app = await buildServer(ctx);
const json = (r: { json: () => any }) => r.json();

const email = `test-${Date.now()}@example.com`;
const signup = json(await app.inject({ method: 'POST', url: '/v1/auth/signup',
  payload: { email, password: 'un-mot-de-passe-solide', display_name: 'Camille' } }));
const auth = { authorization: `Bearer ${signup.tokens.access_token}` };
console.log('1. inscription      →', signup.user.email);

const home = json(await app.inject({ method: 'POST', url: '/v1/homes', headers: auth,
  payload: { name: 'Maison des Lilas', address: '12 rue des Lilas', timezone: 'Europe/Paris' } })).home;
console.log('2. foyer            →', home.name, '| rôle:', home.my_role, '| fuseau:', home.timezone);

const room = json(await app.inject({ method: 'POST', url: `/v1/homes/${home.id}/rooms`, headers: auth,
  payload: { name: 'Salon', icon: 'salon', device_ids: [] } })).room;
console.log('3. pièce            →', room.name);

// Pas d'endpoint de pairing encore : on insère l'appareil directement.
const device = await ctx.prisma.device.create({ data: {
  homeId: home.id, roomId: room.id, name: 'Plafonnier', kind: 'light',
  protocol: 'zigbee', externalId: `0x${randomUUID().slice(0, 7)}`, online: true,
  capabilities: { create: [
    { type: 'on_off', writable: true },
    { type: 'brightness', writable: true, min: 1, max: 100, unit: '%' },
  ] } } });
console.log('4. appareil semé    →', device.name);

const listed = json(await app.inject({ method: 'GET', url: `/v1/homes/${home.id}/devices`, headers: auth }));
console.log('5. liste            →', listed.items.length, 'appareil(s), capacités:',
  listed.items[0].capabilities.map((c: any) => c.type).join(', '));

// Canal temps réel : on écoute AVANT d'envoyer la commande.
const { WebSocket } = await import('ws');
await app.listen({ port: 0, host: '127.0.0.1' });
const addr = app.server.address();
const port = typeof addr === 'object' && addr ? addr.port : 0;
const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime?access_token=${signup.tokens.access_token}`);
const reçus: string[] = [];
ws.on('message', (raw: Buffer) => {
  const m = JSON.parse(raw.toString());
  if (m.kind === 'event') reçus.push(`${m.data.type}${m.data.command ? ':' + m.data.command.status : ''}`);
});
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ type: 'subscribe', home_id: home.id, last_event_id: null }));
await new Promise<void>((resolve) => {
  ws.on('message', (raw: Buffer) => {
    if (JSON.parse(raw.toString()).type === 'subscribed') resolve();
  });
});
console.log('6a. temps réel      → abonné au foyer');

const commandId = randomUUID();
const send = () => app.inject({ method: 'POST', url: `/v1/devices/${device.id}/command`, headers: auth,
  payload: { command_id: commandId, target: { type: 'brightness', value: 62 } } });
const first = json(await send());
console.log('6. commande         →', first.command.status, '| ack:', first.command.ack_semantics,
  '| timeout:', first.command.timeout_ms + 'ms');

const replay = json(await send());
console.log('7. rejeu même id    →', replay.command.command_id === first.command.command_id
  ? 'idempotent, même commande renvoyée' : 'ÉCHEC : doublon créé');

// On scrute plutôt que d'attendre un délai fixe : la confirmation enchaîne
// plusieurs allers-retours vers la base, dont la latence dépend de la région.
const started = Date.now();
let bright: any = null;
while (Date.now() - started < 10_000) {
  const after = json(await app.inject({ method: 'GET', url: `/v1/devices/${device.id}`, headers: auth }));
  bright = after.device.capabilities.find((c: any) => c.type === 'brightness');
  if (bright?.value) break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log('8. état après ack   →', JSON.stringify(bright?.value), `(confirmé en ${Date.now() - started} ms)`);

const cmd = json(await app.inject({ method: 'GET', url: `/v1/devices/${device.id}/commands/${commandId}`, headers: auth }));
console.log('8b. statut commande →', cmd.command.status, '| ack à', cmd.command.acked_at ? 'oui' : 'non');

const history = json(await app.inject({ method: 'GET', url: `/v1/devices/${device.id}/history`, headers: auth }));
console.log('9a. reçus en direct →', reçus.join(', '));
ws.close();
console.log('9. historique       →', history.items.length, 'entrée(s), origine:', history.items[0]?.origin.kind);

const other = json(await app.inject({ method: 'POST', url: '/v1/auth/signup',
  payload: { email: `intrus-${Date.now()}@example.com`, password: 'un-autre-mot-de-passe', display_name: 'Intrus' } }));
const denied = await app.inject({ method: 'GET', url: `/v1/homes/${home.id}/devices`,
  headers: { authorization: `Bearer ${other.tokens.access_token}` } });
console.log('10. isolation       → statut', denied.statusCode, '/', json(denied).error.code);

// Nettoyage : sans lui, chaque exécution laisserait un foyer de test derrière
// elle, et les jeux de données finiraient par se marcher dessus.
await ctx.prisma.user.deleteMany({ where: { email: { in: [email, other.user.email] } } });
await ctx.prisma.home.deleteMany({ where: { id: home.id } });
console.log('11. nettoyage       → données de test supprimées');

await app.close();
await ctx.close();
