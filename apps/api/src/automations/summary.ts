import type { Automation, AutomationAction, AutomationCondition, AutomationTrigger } from '@domotique/contract';

/**
 * Relecture en langage naturel d'une automatisation (écran 3.5).
 *
 * Produite par le serveur, et pas par l'app : c'est le serveur qui exécute, donc
 * lui seul peut garantir que la phrase décrit ce qui se passera réellement. Si
 * l'app la reconstruisait, elle réimplémenterait la logique des déclencheurs et
 * les deux versions divergeraient au premier ajout de condition.
 */

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

function listeFrancaise(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;
}

function decrireJours(weekdays: number[]): string {
  if (weekdays.length === 0) return 'chaque jour';
  const tries = [...weekdays].sort((a, b) => a - b);
  if (tries.join(',') === '1,2,3,4,5') return 'en semaine';
  if (tries.join(',') === '6,7') return 'le week-end';
  return `le ${listeFrancaise(tries.map((d) => JOURS[d - 1]!))}`;
}

function decrireValeur(value: { type: string; value: unknown }): string {
  switch (value.type) {
    case 'on_off':
      return value.value ? 'allumé' : 'éteint';
    case 'brightness':
      return `à ${value.value} %`;
    case 'position':
      return value.value === 0 ? 'fermé' : `ouvert à ${value.value} %`;
    case 'color_temp':
      return `à ${value.value} K`;
    case 'target_temperature':
      return `à ${value.value} °C`;
    case 'contact':
      return value.value === 'open' ? 'ouvert' : 'fermé';
    case 'leak':
      return value.value === 'wet' ? 'en fuite' : 'sec';
    case 'motion':
      return value.value ? 'en mouvement' : 'au calme';
    default:
      return String(value.value);
  }
}

function decrireDeclencheur(trigger: AutomationTrigger, nom: (id: string) => string): string {
  switch (trigger.kind) {
    case 'manual':
      return 'À la demande';
    case 'schedule':
      return `${capitaliser(decrireJours(trigger.weekdays))} à ${trigger.at}`;
    case 'sensor':
      return `Quand ${nom(trigger.device_id)} passe ${decrireValeur(trigger.equals)}`;
    case 'presence':
      return trigger.event === 'first_arrives'
        ? 'Quand quelqu’un arrive'
        : 'Quand tout le monde est parti';
  }
}

function decrireCondition(condition: AutomationCondition, nom: (id: string) => string): string {
  switch (condition.kind) {
    case 'time_range':
      return `entre ${condition.from} et ${condition.to}`;
    case 'device_state':
      return `si ${nom(condition.device_id)} est ${decrireValeur(condition.equals)}`;
    case 'someone_home':
      return condition.value ? 'si quelqu’un est présent' : 'si personne n’est présent';
  }
}

function decrireAction(action: AutomationAction, nom: (id: string) => string): string {
  switch (action.kind) {
    case 'set':
      return `${nom(action.device_id)} ${decrireValeur(action.target)}`;
    case 'wait':
      return `attendre ${action.seconds} s`;
    case 'notify':
      return `envoyer « ${action.message} »`;
  }
}

function capitaliser(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * `deviceNames` doit couvrir tous les appareils cités. Un identifiant absent
 * donne « un appareil supprimé » plutôt qu'un UUID brut à l'écran.
 */
export function buildSummary(
  automation: Pick<Automation, 'trigger' | 'conditions' | 'actions'>,
  deviceNames: Map<string, string>,
): string {
  const nom = (id: string) => deviceNames.get(id) ?? 'un appareil supprimé';

  const parties = [decrireDeclencheur(automation.trigger, nom)];
  if (automation.conditions.length > 0) {
    parties.push(listeFrancaise(automation.conditions.map((c) => decrireCondition(c, nom))));
  }
  const actions = automation.actions.map((a) => decrireAction(a, nom));
  parties.push(listeFrancaise(actions));

  return `${parties.join(', ')}.`;
}
