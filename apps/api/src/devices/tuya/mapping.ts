import type { CapabilityValue, WritableCapabilityValue } from '@domotique/contract';

/**
 * Traduction Data Point Tuya ↔ capacité normalisée du contrat.
 *
 * C'est ici que se joue la garantie du contrat : une luminosité vaut 0-100 côté
 * plateforme, quelle que soit l'échelle native. Tuya expose le plus souvent
 * 10-1000 (parfois 25-255 sur les anciens modèles), et cette conversion est la
 * responsabilité du connecteur — jamais celle de l'application.
 *
 * Les bornes réelles ne sont pas devinées : elles viennent des spécifications de
 * l'appareil (`GET /v1.0/devices/{id}/specifications`). Les valeurs par défaut
 * ci-dessous ne servent que si l'appel de spécification a échoué.
 */

export type DpSpec = { min: number; max: number; scale?: number; step?: number };

/** Correspondance code DP → capacité du contrat. */
const DP_TO_CAPABILITY: Record<string, CapabilityValue['type']> = {
  switch_led: 'on_off',
  switch: 'on_off',
  switch_1: 'on_off',
  bright_value: 'brightness',
  bright_value_v2: 'brightness',
  temp_value: 'color_temp',
  temp_value_v2: 'color_temp',
  percent_control: 'position',
  temp_set: 'target_temperature',
  doorcontact_state: 'contact',
  pir: 'motion',
  watersensor_state: 'leak',
  va_temperature: 'temperature',
  va_humidity: 'humidity',
  battery_percentage: 'battery',
  cur_power: 'power',
  add_ele: 'energy',
};

const CAPABILITY_TO_DP: Partial<Record<CapabilityValue['type'], string>> = {
  on_off: 'switch_led',
  brightness: 'bright_value_v2',
  color_temp: 'temp_value_v2',
  position: 'percent_control',
  target_temperature: 'temp_set',
};

const DEFAULT_SPEC: Record<string, DpSpec> = {
  bright_value_v2: { min: 10, max: 1000 },
  bright_value: { min: 25, max: 255 },
  temp_value_v2: { min: 0, max: 1000 },
  percent_control: { min: 0, max: 100 },
  // Tuya renvoie souvent des entiers mis à l'échelle : 235 avec scale 1 = 23,5 °C.
  temp_set: { min: 5, max: 35, scale: 0 },
  cur_power: { min: 0, max: 50000, scale: 1 },
  add_ele: { min: 0, max: 99999999, scale: 2 },
  va_temperature: { min: -200, max: 600, scale: 1 },
  va_humidity: { min: 0, max: 100 },
};

/** Bornes de température de couleur en kelvins, côté contrat. */
const KELVIN = { min: 2700, max: 6500 } as const;

function applyScale(raw: number, spec: DpSpec | undefined): number {
  return spec?.scale ? raw / 10 ** spec.scale : raw;
}

function removeScale(value: number, spec: DpSpec | undefined): number {
  return Math.round(spec?.scale ? value * 10 ** spec.scale : value);
}

/** Ramène une valeur d'une plage native vers 0-100. */
export function toPercent(raw: number, spec: DpSpec): number {
  if (spec.max === spec.min) return 0;
  const ratio = (raw - spec.min) / (spec.max - spec.min);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Opération inverse : 0-100 vers la plage native de l'appareil. */
export function fromPercent(percent: number, spec: DpSpec): number {
  const ratio = Math.min(100, Math.max(0, percent)) / 100;
  return Math.round(spec.min + ratio * (spec.max - spec.min));
}

/** Data Point reçu de Tuya → valeur du contrat, ou `null` si non pris en charge. */
export function dpToCapability(
  code: string,
  value: unknown,
  specs: Record<string, DpSpec> = {},
): CapabilityValue | null {
  const type = DP_TO_CAPABILITY[code];
  if (!type) return null;
  const spec = specs[code] ?? DEFAULT_SPEC[code];

  switch (type) {
    case 'on_off':
      return typeof value === 'boolean' ? { type: 'on_off', value } : null;
    case 'motion':
      return { type: 'motion', value: value === 'pir' || value === true };
    case 'contact':
      return { type: 'contact', value: value === true ? 'open' : 'closed' };
    case 'leak':
      return { type: 'leak', value: value === 'alarm' ? 'wet' : 'dry' };
    case 'brightness':
    case 'position':
      return typeof value === 'number' && spec
        ? { type, value: toPercent(value, spec) }
        : null;
    case 'color_temp': {
      if (typeof value !== 'number' || !spec) return null;
      const ratio = toPercent(value, spec) / 100;
      return { type: 'color_temp', value: Math.round(KELVIN.min + ratio * (KELVIN.max - KELVIN.min)) };
    }
    case 'target_temperature':
    case 'temperature':
    case 'humidity':
    case 'battery':
    case 'power':
    case 'energy':
      return typeof value === 'number' ? ({ type, value: applyScale(value, spec) } as CapabilityValue) : null;
    default:
      return null;
  }
}

/** Valeur du contrat → Data Point Tuya. */
export function capabilityToDp(
  target: WritableCapabilityValue,
  specs: Record<string, DpSpec> = {},
): { code: string; value: unknown } | null {
  const code = CAPABILITY_TO_DP[target.type];
  if (!code) return null;
  const spec = specs[code] ?? DEFAULT_SPEC[code];

  switch (target.type) {
    case 'on_off':
      return { code, value: target.value };
    case 'brightness':
    case 'position':
      return spec ? { code, value: fromPercent(target.value, spec) } : null;
    case 'color_temp': {
      if (!spec) return null;
      const ratio = (target.value - KELVIN.min) / (KELVIN.max - KELVIN.min);
      return { code, value: fromPercent(Math.min(1, Math.max(0, ratio)) * 100, spec) };
    }
    case 'target_temperature':
      return { code, value: removeScale(target.value, spec) };
    default:
      return null;
  }
}
