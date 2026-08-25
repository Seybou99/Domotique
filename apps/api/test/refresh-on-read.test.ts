import { describe, expect, it, vi } from 'vitest';
import { DeviceService } from '../src/devices/service.js';

/**
 * Rafraîchissement à la lecture.
 *
 * Le garde-fou compte autant que le rafraîchissement lui-même : sans lui,
 * chaque écran ouvert déclencherait un appel par appareil au cloud du
 * fournisseur, dont le quota mensuel est plafonné et sans dépassement possible.
 */
function harness(deviceCount: number) {
  const devices = Array.from({ length: deviceCount }, (_, i) => ({
    id: `dev-${i}`,
    externalId: `ext-${i}`,
    unitId: null,
    accountId: 'compte',
    protocol: 'tuya',
  }));

  const getState = vi.fn().mockResolvedValue([{ type: 'on_off', value: true }]);
  const prisma = { device: { findMany: vi.fn().mockResolvedValue(devices) } };
  const connectors = { get: () => ({ getState, onStateChange: () => () => {} }) };
  const state = { set: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined) };

  // `stateChange.create` est appelé par recordState ; on ne teste pas l'écriture.
  Object.assign(prisma, { stateChange: { create: vi.fn().mockResolvedValue({}) } });

  const service = new DeviceService(
    prisma as never,
    connectors as never,
    state as never,
    events as never,
  );
  return { service, getState };
}

describe('rafraîchissement à la lecture', () => {
  it('relit l’état de chaque appareil du foyer', async () => {
    const { service, getState } = harness(3);
    await service.refreshHome('foyer');
    expect(getState).toHaveBeenCalledTimes(3);
  });

  it('ne rappelle pas la source dans la fenêtre du garde-fou', async () => {
    const { service, getState } = harness(2);
    await service.refreshHome('foyer');
    await service.refreshHome('foyer');
    await service.refreshHome('foyer');
    // Deux appareils, un seul tour : les deux suivants sont écartés.
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('rafraîchit à nouveau une fois la fenêtre écoulée', async () => {
    const { service, getState } = harness(1);
    await service.refreshHome('foyer', 0);
    await service.refreshHome('foyer', 0);
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('compte les foyers séparément', async () => {
    const { service, getState } = harness(1);
    await service.refreshHome('foyer-a');
    await service.refreshHome('foyer-b');
    expect(getState).toHaveBeenCalledTimes(2);
  });
});
