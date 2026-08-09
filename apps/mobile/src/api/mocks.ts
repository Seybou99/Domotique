import { device, type Device, type CapabilityState } from '@domotique/contract';

/**
 * Jeu de données de démonstration, **validé par le contrat**.
 *
 * Chaque objet passe par `device.parse()` : si le contrat évolue et que ces
 * fixtures ne suivent pas, la galerie échoue au chargement plutôt que d'afficher
 * des données qui n'existeront jamais en production. C'est le seul intérêt d'un
 * mock — sinon il ment.
 */

const HOME = '9b1d1f2a-1c3e-4a5b-8c7d-2e3f4a5b6c7d';
const SALON = '2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CUISINE = '3b2c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const NOW = '2026-08-08T21:04:00Z';

function cap(
  type: CapabilityState['type'],
  value: CapabilityState['value'],
  writable = true,
  extra: Partial<CapabilityState['schema']> = {},
): CapabilityState {
  return {
    type,
    schema: { type, writable, min: null, max: null, step: null, unit: 'none', ...extra },
    value,
    updated_at: NOW,
  };
}

const raw = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    home_id: HOME,
    room_id: SALON,
    name: 'Plafonnier',
    kind: 'light',
    source: {
      protocol: 'zigbee',
      external_id: '0x0001a3f',
      third_party_account_id: null,
      device_unit_id: '99999999-9999-4999-8999-999999999999',
    },
    online: true,
    last_seen: NOW,
    capabilities: [
      cap('on_off', { type: 'on_off', value: true }),
      cap('brightness', { type: 'brightness', value: 62 }, true, { min: 1, max: 100, unit: '%' }),
      cap('energy', { type: 'energy', value: 0.064 }, false, { unit: 'kWh' }),
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    home_id: HOME,
    room_id: SALON,
    name: 'Lampe canapé',
    kind: 'lamp',
    source: {
      protocol: 'hue',
      external_id: 'hue-4471',
      third_party_account_id: '88888888-8888-4888-8888-888888888888',
      device_unit_id: null,
    },
    online: true,
    last_seen: NOW,
    capabilities: [
      cap('on_off', { type: 'on_off', value: true }),
      cap('brightness', { type: 'brightness', value: 28 }, true, { min: 1, max: 100, unit: '%' }),
    ],
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    home_id: HOME,
    room_id: SALON,
    name: 'Prise TV',
    kind: 'plug',
    source: {
      protocol: 'tuya',
      external_id: 'bf1a2b3c4d5e',
      third_party_account_id: '77777777-7777-4777-8777-777777777777',
      device_unit_id: null,
    },
    online: true,
    last_seen: NOW,
    capabilities: [
      cap('on_off', { type: 'on_off', value: true }),
      cap('power', { type: 'power', value: 42 }, false, { unit: 'W' }),
    ],
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    home_id: HOME,
    room_id: CUISINE,
    name: 'Prise bouilloire',
    kind: 'plug',
    source: {
      protocol: 'tuya',
      external_id: 'bf9z8y7x6w5v',
      third_party_account_id: '77777777-7777-4777-8777-777777777777',
      device_unit_id: null,
    },
    online: true,
    last_seen: NOW,
    capabilities: [cap('on_off', { type: 'on_off', value: false })],
  },
  {
    // Capteur : aucune capacité pilotable → l'adaptateur n'affiche pas de bascule.
    id: '55555555-5555-4555-8555-555555555555',
    home_id: HOME,
    room_id: SALON,
    name: 'Capteur porte-fenêtre',
    kind: 'contact',
    source: {
      protocol: 'zigbee',
      external_id: '0x0004b2c',
      third_party_account_id: null,
      device_unit_id: '99999999-9999-4999-8999-999999999999',
    },
    online: true,
    last_seen: NOW,
    capabilities: [
      cap('contact', { type: 'contact', value: 'closed' }, false),
      cap('battery', { type: 'battery', value: 87 }, false, { unit: '%' }),
    ],
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    home_id: HOME,
    room_id: CUISINE,
    name: 'Détecteur de fuite',
    kind: 'leak',
    source: {
      protocol: 'zigbee',
      external_id: '0x0007e1a',
      third_party_account_id: null,
      device_unit_id: '99999999-9999-4999-8999-999999999999',
    },
    online: false,
    last_seen: '2026-08-08T18:04:00Z',
    capabilities: [cap('leak', { type: 'leak', value: 'dry' }, false)],
  },
];

export const mockDevices: Device[] = raw.map((d) => device.parse(d));

export const mockRoomNames: Record<string, string> = {
  [SALON]: 'Salon',
  [CUISINE]: 'Cuisine',
};
