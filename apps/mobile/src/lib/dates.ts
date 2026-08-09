/**
 * Formats de date de l'interface.
 *
 * Point d'attention : « hier » se calcule en **jours calendaires**, pas en durée
 * écoulée. Un événement d'il y a douze heures peut très bien dater d'hier —
 * comparer `Date.now() - date` à 24 h l'affiche « aujourd'hui », ce qui est faux
 * une fois sur deux en soirée.
 */

const heure = (date: Date) =>
  date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function joursCalendairesEcoules(date: Date, maintenant = new Date()): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** « Aujourd'hui · 11:21 », « Hier · 23:41 », « 06/08 · 09:12 ». */
export function formatDateTime(iso: string, separateur = ' · '): string {
  const date = new Date(iso);
  const jours = joursCalendairesEcoules(date);
  if (jours === 0) return `Aujourd’hui${separateur}${heure(date)}`;
  if (jours === 1) return `Hier${separateur}${heure(date)}`;
  return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}${separateur}${heure(date)}`;
}

/** « Aujourd'hui à 11:21 » — variante pour les phrases (« Dernière exécution … »). */
export function formatDateTimeLong(iso: string): string {
  return formatDateTime(iso, ' à ').replace('Aujourd’hui à', 'Aujourd’hui à');
}

/** « il y a 2 s », pour la fraîcheur d'une donnée technique (écran 2.2). */
export function formatAgo(iso: string): string {
  const secondes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secondes < 60) return `il y a ${secondes} s`;
  if (secondes < 3600) return `il y a ${Math.round(secondes / 60)} min`;
  if (secondes < 86_400) return `il y a ${Math.round(secondes / 3600)} h`;
  return formatDateTime(iso);
}
