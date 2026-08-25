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

export type DpSpec = { min?: number; max?: number; scale?: number; step?: number };

/** Une plage n'existe que sur les Data Points numériques. */
function hasRange(spec: DpSpec | undefined): spec is DpSpec & { min: number; max: number } {
  return typeof spec?.min === 'number' && typeof spec.max === 'number';
}

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
  // Deux générations coexistent chez Tuya : `colour_data_v2` porte un objet
  // {h,s,v}, `colour_data` une chaîne hexadécimale. Les ampoules récentes
  // exposent souvent les deux ; la v2 est lue en priorité par l'ordre de ce
  // tableau, la v1 sert aux modèles anciens.
  colour_data_v2: 'color_hs',
  colour_data: 'color_hs',
};

/**
 * Codes de commande acceptés, par ordre de préférence.
 *
 * **Une capacité, plusieurs codes selon l'appareil.** Une ampoule s'allume par
 * `switch_led`, une prise par `switch_1` — envoyer l'un à l'autre ne provoque
 * aucune erreur : le fournisseur accepte la requête, et l'appareil l'ignore.
 * Vérifié en conditions réelles sur une prise dont la fiche ne déclare que
 * `switch_1` : la commande partait en `switch_led`, était acquittée, et rien ne
 * se passait. Le code retenu est donc le premier que l'appareil déclare.
 */
const CAPABILITY_TO_DP: Partial<Record<CapabilityValue['type'], string[]>> = {
  on_off: ['switch_led', 'switch_1', 'switch'],
  brightness: ['bright_value_v2', 'bright_value'],
  color_temp: ['temp_value_v2', 'temp_value'],
  color_hs: ['colour_data_v2', 'colour_data'],
  position: ['percent_control'],
  target_temperature: ['temp_set'],
};

const DEFAULT_SPEC: Record<string, DpSpec> = {
  bright_value_v2: { min: 10, max: 1000 },
  bright_value: { min: 25, max: 255 },
  temp_value_v2: { min: 0, max: 1000 },
  percent_control: { min: 0, max: 100 },
  // Tuya renvoie souvent des entiers mis à l'échelle : 235 avec scale 1 = 23,5 °C.
  temp_set: { min: 5, max: 35, scale: 0 },
  cur_power: { min: 0, max: 50000, scale: 1 },
  // Échelle 3, relevée sur la fiche de l'appareil : la prise LSC déclare
  // `{"min":0,"max":50000,"scale":3,"step":100}`. Avec 2, une consommation
  // s'affichait dix fois trop grande — et rien ne l'aurait signalé, la valeur
  // restant plausible. Les modèles qui s'en écartent sont couverts par les
  // spécifications lues sur l'appareil, qui priment sur ce défaut.
  add_ele: { min: 0, max: 50000, scale: 3 },
  va_temperature: { min: -200, max: 600, scale: 1 },
  va_humidity: { min: 0, max: 100 },
};

/** Bornes de température de couleur en kelvins, côté contrat. */
const KELVIN = { min: 2700, max: 6500 } as const;

/**
 * Couleur Tuya → teinte et saturation du contrat.
 *
 * Deux encodages selon la génération de l'ampoule, et l'appareil ne dit pas
 * lequel il emploie : un objet `{h, s, v}`, ou une chaîne hexadécimale de douze
 * caractères où chaque grandeur tient sur quatre. La saturation vaut 0-1000 chez
 * Tuya, 0-100 dans le contrat.
 *
 * La valeur (`v`) est ignorée : c'est la luminosité, que le contrat porte
 * séparément dans `brightness`.
 */
function parseColour(value: unknown): { h: number; s: number } | null {
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n)));

  if (typeof value === 'object' && value !== null) {
    const { h, s } = value as { h?: unknown; s?: unknown };
    if (typeof h === 'number' && typeof s === 'number') {
      return { h: clamp(h, 360), s: clamp(s / 10, 100) };
    }
    return null;
  }

  if (typeof value !== 'string' || value.length < 12) return null;
  // Certaines ampoules renvoient l'objet sous forme de chaîne JSON.
  if (value.trim().startsWith('{')) {
    try {
      return parseColour(JSON.parse(value));
    } catch {
      return null;
    }
  }

  const h = Number.parseInt(value.slice(0, 4), 16);
  const s = Number.parseInt(value.slice(4, 8), 16);
  if (Number.isNaN(h) || Number.isNaN(s)) return null;
  return { h: clamp(h, 360), s: clamp(s / 10, 100) };
}

function applyScale(raw: number, spec: DpSpec | undefined): number {
  return spec?.scale ? raw / 10 ** spec.scale : raw;
}

function removeScale(value: number, spec: DpSpec | undefined): number {
  return Math.round(spec?.scale ? value * 10 ** spec.scale : value);
}

/** Ramène une valeur d'une plage native vers 0-100. */
export function toPercent(raw: number, spec: DpSpec & { min: number; max: number }): number {
  if (spec.max === spec.min) return 0;
  const ratio = (raw - spec.min) / (spec.max - spec.min);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

/** Opération inverse : 0-100 vers la plage native de l'appareil. */
export function fromPercent(
  percent: number,
  spec: DpSpec & { min: number; max: number },
): number {
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
      return typeof value === 'number' && hasRange(spec)
        ? { type, value: toPercent(value, spec) }
        : null;
    case 'color_temp': {
      if (typeof value !== 'number' || !hasRange(spec)) return null;
      const ratio = toPercent(value, spec) / 100;
      return { type: 'color_temp', value: Math.round(KELVIN.min + ratio * (KELVIN.max - KELVIN.min)) };
    }
    case 'color_hs': {
      const colour = parseColour(value);
      return colour ? { type: 'color_hs', value: { h: colour.h, s: colour.s } } : null;
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
  const candidates = CAPABILITY_TO_DP[target.type];
  if (!candidates?.length) return null;
  // Le premier code que l'appareil déclare ; à défaut de fiche, le plus courant.
  const code = candidates.find((candidate) => candidate in specs) ?? candidates[0]!;
  const spec = specs[code] ?? DEFAULT_SPEC[code];

  switch (target.type) {
    case 'on_off':
      return { code, value: target.value };
    case 'brightness':
    case 'position':
      return hasRange(spec) ? { code, value: fromPercent(target.value, spec) } : null;
    case 'color_temp': {
      if (!hasRange(spec)) return null;
      const ratio = (target.value - KELVIN.min) / (KELVIN.max - KELVIN.min);
      return { code, value: fromPercent(Math.min(1, Math.max(0, ratio)) * 100, spec) };
    }
    case 'target_temperature':
      return { code, value: removeScale(target.value, spec) };
    /**
     * La valeur envoyée est maximale, faute de connaître celle en cours.
     *
     * Chez Tuya, la luminosité d'une ampoule en mode couleur est portée par le
     * `v` de ce même Data Point, et non par `bright_value` : envoyer une teinte
     * impose donc d'envoyer aussi une luminosité. Reprendre celle du moment
     * demanderait l'état courant, dont cette fonction ne dispose pas — elle
     * traduit une valeur, elle ne lit pas l'appareil. Choisir 1000 allume à
     * pleine puissance ; c'est visible, donc corrigible d'un geste, là qu'une
     * valeur basse arbitraire donnerait une ampoule qui s'éteint presque en
     * changeant de couleur.
     */
    case 'color_hs':
      return {
        code,
        value: {
          h: Math.round(target.value.h),
          s: Math.round(target.value.s * 10),
          v: 1000,
        },
      };
    default:
      return null;
  }
}
