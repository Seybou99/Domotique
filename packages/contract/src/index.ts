/**
 * @domotique/contract — contrat partagé backend ↔ application (CDC backend §12).
 *
 * Le backend valide ses entrées et ses sorties avec ces schémas ; l'app en dérive
 * ses types. Si un connecteur laisse fuiter un champ propre à Tuya dans une
 * réponse, la validation le signale au lieu de dépendre d'une relecture.
 */

export * from './primitives.js';

export * from './domain/home.js';
export * from './domain/device.js';
export * from './domain/capability.js';
export * from './domain/command.js';
export * from './domain/automation.js';
export * from './domain/alert.js';
export * from './domain/thirdParty.js';

export * from './rest/define.js';
export {
  api,
  auth,
  homes,
  rooms,
  units,
  devices,
  integrations,
  automations,
  alerts,
  type Api,
} from './rest/endpoints.js';

export * from './ws/events.js';
