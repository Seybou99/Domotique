import { describe, expect, it } from 'vitest';
import { capabilityToDp, dpToCapability } from '../src/devices/tuya/mapping.js';

/**
 * Correspondance des Data Points Tuya.
 *
 * Ces conversions ne se vérifient pas à l'œil : une échelle erronée donne une
 * valeur parfaitement plausible — dix fois trop grande, mais plausible. Les cas
 * ci-dessous viennent des fiches techniques réelles relevées sur les appareils.
 */
describe('consommation', () => {
  it('applique l’échelle déclarée par l’appareil', () => {
    // Fiche réelle de la prise LSC : {"min":0,"max":50000,"scale":3,"step":100}.
    const specs = { add_ele: { min: 0, max: 50000, scale: 3 } };
    expect(dpToCapability('add_ele', 1234, specs)).toEqual({ type: 'energy', value: 1.234 });
  });

  it('retient l’échelle 3 par défaut, faute de fiche', () => {
    // Le défaut valait 2 : la consommation ressortait dix fois trop grande.
    expect(dpToCapability('add_ele', 1234)).toEqual({ type: 'energy', value: 1.234 });
  });

  it('convertit la puissance instantanée en watts', () => {
    // `cur_power` est en dixièmes de watt : 2352 vaut 235,2.
    expect(dpToCapability('cur_power', 2352)).toEqual({ type: 'power', value: 235.2 });
  });
});

describe('couleur', () => {
  it('lit l’objet des ampoules récentes', () => {
    expect(dpToCapability('colour_data_v2', { h: 240, s: 1000, v: 1000 })).toEqual({
      type: 'color_hs',
      value: { h: 240, s: 100 },
    });
  });

  it('lit la chaîne hexadécimale des ampoules anciennes', () => {
    // 00f0 = 240, 03e8 = 1000 → saturation pleine.
    expect(dpToCapability('colour_data', '00f003e803e8')).toEqual({
      type: 'color_hs',
      value: { h: 240, s: 100 },
    });
  });

  it('accepte l’objet transmis sous forme de chaîne', () => {
    expect(dpToCapability('colour_data_v2', '{"h":120,"s":500,"v":1000}')).toEqual({
      type: 'color_hs',
      value: { h: 120, s: 50 },
    });
  });

  it('ignore une valeur inexploitable plutôt que d’inventer une couleur', () => {
    expect(dpToCapability('colour_data_v2', 'nawak')).toBeNull();
    expect(dpToCapability('colour_data_v2', 42)).toBeNull();
  });

  it('renvoie la saturation à l’échelle de Tuya', () => {
    expect(capabilityToDp({ type: 'color_hs', value: { h: 200, s: 40 } })).toEqual({
      code: 'colour_data_v2',
      value: { h: 200, s: 400, v: 1000 },
    });
  });
});

describe('allumage', () => {
  it('reconnaît les trois codes de commutation', () => {
    for (const code of ['switch_led', 'switch', 'switch_1']) {
      expect(dpToCapability(code, true)).toEqual({ type: 'on_off', value: true });
    }
  });
});
