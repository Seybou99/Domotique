import { getCapability, type Device, type DeviceKind } from '@domotique/contract';
import { deviceIcons } from '../lib/icons';
import type { DeviceRowProps } from '../components/DeviceRow';

/**
 * Traduction `Device` (contrat) → props du design system.
 *
 * C'est le seul endroit où les deux mondes se rencontrent. Le tenir isolé rend
 * visible tout écart entre ce que le backend fournit et ce que l'interface
 * affiche — c'est ainsi qu'on a découvert que l'origine d'un changement d'état
 * manquait au CDC.
 */

const KIND_TO_ICON: Record<DeviceKind, keyof typeof deviceIcons> = {
  light: 'light',
  lamp: 'lamp',
  plug: 'plug',
  contact: 'contact',
  leak: 'leak',
  thermostat: 'thermostat',
  cover: 'cover',
  fan: 'fan',
  lock: 'lock',
};

const PROTOCOL_LABEL = { zigbee: 'Zigbee', tuya: 'Tuya', hue: 'Hue', tapo: 'Tapo' } as const;

/**
 * Ambre pour tout ce qui éclaire ou chauffe, sarcelle pour le reste (charte §1.1).
 * Une prise générique n'est pas de la lumière : elle prend l'accent réseau.
 */
function toneFor(kind: DeviceKind): 'energy' | 'network' {
  return kind === 'light' || kind === 'lamp' || kind === 'thermostat' ? 'energy' : 'network';
}

/** Métadonnée courte affichée sous le nom — « 62 % », « allumé », « pile 87 % ». */
function metaFor(device: Device): string | undefined {
  const brightness = getCapability(device, 'brightness')?.value;
  if (brightness?.type === 'brightness') return `${Math.round(brightness.value)} %`;

  const onOff = getCapability(device, 'on_off')?.value;
  if (onOff?.type === 'on_off') return onOff.value ? 'allumé' : 'éteint';

  const battery = getCapability(device, 'battery')?.value;
  if (battery?.type === 'battery') return `pile ${Math.round(battery.value)} %`;

  return undefined;
}

/** Puce de statut des capteurs, qui n'ont pas de bascule. */
function statusFor(device: Device): DeviceRowProps['status'] {
  const contact = getCapability(device, 'contact')?.value;
  if (contact?.type === 'contact') {
    return contact.value === 'closed'
      ? { label: 'Fermé', tone: 'success' }
      : { label: 'Ouvert', tone: 'alert' };
  }
  const leak = getCapability(device, 'leak')?.value;
  if (leak?.type === 'leak') {
    return leak.value === 'dry' ? { label: 'Sec', tone: 'success' } : { label: 'Fuite', tone: 'alert' };
  }
  const motion = getCapability(device, 'motion')?.value;
  if (motion?.type === 'motion') {
    return motion.value ? { label: 'Mouvement', tone: 'alert' } : { label: 'Calme', tone: 'online' };
  }
  return undefined;
}

export function toDeviceRow(
  device: Device,
  options: { roomName?: string; pending?: boolean; onValueChange?: (v: boolean) => void; onPress?: () => void } = {},
): DeviceRowProps {
  const onOff = getCapability(device, 'on_off');
  const isOn = onOff?.value?.type === 'on_off' ? onOff.value.value : undefined;
  const status = statusFor(device);

  return {
    icon: deviceIcons[KIND_TO_ICON[device.kind]],
    name: device.name,
    meta: metaFor(device),
    protocol: PROTOCOL_LABEL[device.source.protocol],
    room: options.roomName,
    online: device.online,
    tone: toneFor(device.kind),
    value: isOn,
    // Une capacité en lecture seule n'expose pas de bascule : c'est le schéma du
    // contrat qui le décide, pas une liste d'exceptions codée dans l'interface.
    onValueChange: onOff?.schema.writable ? options.onValueChange : undefined,
    pending: options.pending,
    status,
    onPress: options.onPress,
  };
}
