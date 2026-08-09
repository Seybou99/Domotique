/**
 * Jeu de démonstration.
 *
 * Reproduit le foyer des maquettes — « Maison des Lilas », quatre pièces, huit
 * appareils, quatre scènes — pour que l'application ait quelque chose à afficher
 * avant qu'un vrai boîtier ou un vrai compte Tuya n'existe.
 *
 *   npm run seed --workspace api
 *
 * Idempotent : relancer le script réutilise le compte et remet les mêmes données.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/http/auth.js';
import { MemoryStateStore, RedisStateStore, type StateStore } from '../src/state/store.js';
import { loadEnv } from '../src/env.js';
import Redis from 'ioredis';

const env = loadEnv();
const prisma = new PrismaClient();

const EMAIL = 'demo@domotique.local';
const PASSWORD = 'demo-mot-de-passe';

const user =
  (await prisma.user.findUnique({ where: { email: EMAIL } })) ??
  (await prisma.user.create({
    data: { email: EMAIL, passwordHash: await hashPassword(PASSWORD), displayName: 'Camille' },
  }));

// On repart d'un foyer propre : le script doit être rejouable sans accumuler.
await prisma.home.deleteMany({ where: { members: { some: { userId: user.id, role: 'owner' } } } });

const home = await prisma.home.create({
  data: {
    name: 'Maison des Lilas',
    address: '12 rue des Lilas, Paris',
    timezone: 'Europe/Paris',
    members: { create: { userId: user.id, role: 'owner', joinedAt: new Date() } },
  },
});

const rooms = await Promise.all(
  [
    { name: 'Salon', icon: 'salon' },
    { name: 'Cuisine', icon: 'cuisine' },
    { name: 'Chambre', icon: 'chambre' },
    { name: 'Bureau', icon: 'bureau' },
  ].map((room, index) =>
    prisma.room.create({ data: { homeId: home.id, ...room, sortOrder: index } }),
  ),
);
const [salon, cuisine, chambre, bureau] = rooms;

const unit = await prisma.deviceUnit.create({
  data: {
    homeId: home.id,
    serial: `DMT-DEMO-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    name: 'Boîtier salon',
    online: true,
    lastHeartbeat: new Date(),
    agentVersion: '0.1.0',
    certExpiresAt: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000),
  },
});

type Spec = {
  name: string;
  kind: string;
  roomId: string;
  protocol: 'zigbee' | 'tuya' | 'hue';
  online?: boolean;
  caps: { type: string; writable: boolean; min?: number; max?: number; unit?: string }[];
  values: { type: string; value: unknown }[];
};

const specs: Spec[] = [
  {
    name: 'Plafonnier', kind: 'light', roomId: salon!.id, protocol: 'zigbee',
    caps: [
      { type: 'on_off', writable: true },
      { type: 'brightness', writable: true, min: 1, max: 100, unit: '%' },
      { type: 'energy', writable: false, unit: 'kWh' },
    ],
    values: [
      { type: 'on_off', value: true },
      { type: 'brightness', value: 62 },
      { type: 'energy', value: 0.064 },
    ],
  },
  {
    name: 'Lampe canapé', kind: 'lamp', roomId: salon!.id, protocol: 'hue',
    caps: [
      { type: 'on_off', writable: true },
      { type: 'brightness', writable: true, min: 1, max: 100, unit: '%' },
    ],
    values: [
      { type: 'on_off', value: true },
      { type: 'brightness', value: 28 },
    ],
  },
  {
    name: 'Prise TV', kind: 'plug', roomId: salon!.id, protocol: 'tuya',
    caps: [
      { type: 'on_off', writable: true },
      { type: 'power', writable: false, unit: 'W' },
    ],
    values: [
      { type: 'on_off', value: true },
      { type: 'power', value: 42 },
    ],
  },
  {
    name: 'Capteur porte-fenêtre', kind: 'contact', roomId: salon!.id, protocol: 'zigbee',
    caps: [
      { type: 'contact', writable: false },
      { type: 'battery', writable: false, unit: '%' },
    ],
    values: [
      { type: 'contact', value: 'closed' },
      { type: 'battery', value: 87 },
    ],
  },
  {
    name: 'Spots plan de travail', kind: 'light', roomId: cuisine!.id, protocol: 'zigbee',
    caps: [
      { type: 'on_off', writable: true },
      { type: 'brightness', writable: true, min: 1, max: 100, unit: '%' },
    ],
    values: [
      { type: 'on_off', value: true },
      { type: 'brightness', value: 80 },
    ],
  },
  {
    name: 'Prise bouilloire', kind: 'plug', roomId: cuisine!.id, protocol: 'tuya',
    caps: [{ type: 'on_off', writable: true }],
    values: [{ type: 'on_off', value: false }],
  },
  {
    // Hors ligne volontairement : le tableau de bord doit afficher son bandeau.
    name: 'Détecteur de fuite', kind: 'leak', roomId: cuisine!.id, protocol: 'zigbee',
    online: false,
    caps: [{ type: 'leak', writable: false }],
    values: [{ type: 'leak', value: 'dry' }],
  },
  {
    name: 'Lampe de chevet', kind: 'lamp', roomId: chambre!.id, protocol: 'zigbee',
    caps: [
      { type: 'on_off', writable: true },
      { type: 'brightness', writable: true, min: 1, max: 100, unit: '%' },
    ],
    values: [
      { type: 'on_off', value: false },
      { type: 'brightness', value: 35 },
    ],
  },
  {
    name: 'Lampe de bureau', kind: 'lamp', roomId: bureau!.id, protocol: 'zigbee',
    caps: [{ type: 'on_off', writable: true }],
    values: [{ type: 'on_off', value: false }],
  },
];

const store: StateStore = env.REDIS_URL
  ? new RedisStateStore(new Redis(env.REDIS_URL))
  : new MemoryStateStore();

const created = [];
for (const [index, spec] of specs.entries()) {
  const device = await prisma.device.create({
    data: {
      homeId: home.id,
      roomId: spec.roomId,
      name: spec.name,
      kind: spec.kind,
      protocol: spec.protocol,
      externalId: `0x${(0x1000 + index).toString(16)}`,
      unitId: spec.protocol === 'zigbee' ? unit.id : null,
      online: spec.online ?? true,
      lastSeen: new Date(),
      capabilities: {
        create: spec.caps.map((c) => ({
          type: c.type,
          writable: c.writable,
          min: c.min ?? null,
          max: c.max ?? null,
          unit: c.unit ?? 'none',
          // Instantané en base : sans Redis, c'est lui qui alimente l'affichage.
          snapshotValue: spec.values.find((v) => v.type === c.type) ?? undefined,
          snapshotUpdatedAt: new Date(),
        })),
      },
    },
  });
  created.push(device);

  for (const value of spec.values) {
    await store.set(device.id, value as never);
  }
}

const plafonnier = created[0]!;
const lampeCanape = created[1]!;
const priseTV = created[2]!;
const chevet = created[7]!;

await prisma.automation.createMany({
  data: [
    {
      homeId: home.id, name: 'Soirée cinéma', icon: 'cinema', triggerKind: 'manual',
      trigger: { kind: 'manual' }, conditions: [],
      actions: [
        { kind: 'set', device_id: plafonnier.id, target: { type: 'brightness', value: 15 } },
        { kind: 'set', device_id: lampeCanape.id, target: { type: 'brightness', value: 40 } },
        { kind: 'set', device_id: priseTV.id, target: { type: 'on_off', value: true } },
      ],
      enabled: true,
    },
    {
      homeId: home.id, name: 'Bonne nuit', icon: 'nuit', triggerKind: 'schedule',
      trigger: { kind: 'schedule', at: '23:30', weekdays: [] }, conditions: [],
      actions: [
        { kind: 'set', device_id: plafonnier.id, target: { type: 'on_off', value: false } },
        { kind: 'set', device_id: lampeCanape.id, target: { type: 'on_off', value: false } },
      ],
      enabled: true,
    },
    {
      homeId: home.id, name: 'Réveil', icon: 'reveil', triggerKind: 'schedule',
      trigger: { kind: 'schedule', at: '06:45', weekdays: [1, 2, 3, 4, 5] }, conditions: [],
      actions: [{ kind: 'set', device_id: chevet.id, target: { type: 'on_off', value: true } }],
      enabled: true,
    },
    {
      homeId: home.id, name: 'Départ', icon: 'depart', triggerKind: 'manual',
      trigger: { kind: 'manual' }, conditions: [],
      actions: created
        .filter((d) => d.kind !== 'contact' && d.kind !== 'leak')
        .map((d) => ({ kind: 'set', device_id: d.id, target: { type: 'on_off', value: false } })),
      enabled: false,
    },
  ],
});

await prisma.alert.createMany({
  data: [
    {
      homeId: home.id, deviceId: created[3]!.id, category: 'security', severity: 'warning',
      title: 'Porte-fenêtre ouverte', body: 'Le capteur du salon signale une ouverture.',
      createdAt: new Date(Date.now() - 20 * 60_000),
    },
    {
      homeId: home.id, deviceId: created[6]!.id, category: 'connectivity', severity: 'warning',
      title: 'Détecteur de fuite hors ligne', body: 'Aucun relevé depuis 3 heures.',
      createdAt: new Date(Date.now() - 3 * 3600_000),
    },
    {
      homeId: home.id, category: 'activity', severity: 'info',
      title: 'Scène « Bonne nuit » exécutée', read: true,
      createdAt: new Date(Date.now() - 12 * 3600_000),
    },
  ],
});

console.log('Jeu de démonstration créé.');
console.log('');
console.log('  Foyer     :', home.name, `(${rooms.length} pièces, ${created.length} appareils)`);
console.log('  Boîtier   :', unit.serial);
console.log('');
console.log('  Connexion :', EMAIL);
console.log('  Mot de passe :', PASSWORD);

await prisma.$disconnect();
await store.close();
process.exit(0);
