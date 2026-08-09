/**
 * Calcul des échéances d'un déclencheur horaire, dans le fuseau du foyer.
 *
 * « Chaque soir à 23:30 » n'a pas de sens en UTC : selon la saison, 23:30 à
 * Paris tombe à 21:30 ou 22:30 UTC. Sans fuseau, une automatisation dériverait
 * d'une heure deux fois par an — et personne ne ferait le lien avec l'heure d'été.
 *
 * Volontairement sans dépendance : `Intl` fournit tout ce qu'il faut, et une
 * bibliothèque de dates est une surface de maintenance de plus.
 */

/** Décalage du fuseau, en millisecondes, à cet instant précis. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    format.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  // `Intl` rend minuit sous la forme « 24 » sur certaines plateformes.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** Composantes locales d'un instant dans un fuseau donné. */
export function zonedParts(instant: Date, timeZone: string) {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    /** 1 = lundi, 7 = dimanche (ISO-8601). */
    weekday: local.getUTCDay() === 0 ? 7 : local.getUTCDay(),
  };
}

/**
 * Instant UTC correspondant à une date et une heure locales.
 *
 * Deux passes : la première estime le décalage, la seconde le corrige. Une seule
 * passe se trompe d'une heure aux abords d'un changement d'heure, parce que le
 * décalage à appliquer n'est pas celui de l'instant estimé.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  instant = new Date(naive - zoneOffsetMs(instant, timeZone));
  return instant;
}

export type ScheduleTrigger = {
  /** « HH:MM » dans le fuseau du foyer. */
  at: string;
  /** Vide = tous les jours. 1 = lundi. */
  weekdays: number[];
};

/**
 * Échéances tombant dans l'intervalle `]after, until]`.
 *
 * L'intervalle est ouvert à gauche pour qu'un tick ne rejoue pas l'échéance déjà
 * traitée par le tick précédent. On balaie trois jours locaux autour de la
 * fenêtre : suffisant pour tout intervalle raisonnable, et robuste au décalage
 * de fuseau qui peut faire changer de date locale.
 */
export function occurrencesBetween(
  trigger: ScheduleTrigger,
  after: Date,
  until: Date,
  timeZone: string,
): Date[] {
  const [hourText, minuteText] = trigger.at.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return [];

  const out: Date[] = [];
  const base = zonedParts(until, timeZone);

  for (let dayShift = -1; dayShift <= 1; dayShift++) {
    const localDay = new Date(Date.UTC(base.year, base.month - 1, base.day + dayShift));
    const instant = zonedTimeToUtc(
      localDay.getUTCFullYear(),
      localDay.getUTCMonth() + 1,
      localDay.getUTCDate(),
      hour,
      minute,
      timeZone,
    );

    if (instant <= after || instant > until) continue;

    /**
     * Le jour de la semaine est celui de l'instant **réel**, pas celui de la
     * date locale visée : au passage à l'heure d'hiver, 02:30 local peut
     * correspondre à un instant retombant la veille en UTC.
     */
    const weekday = zonedParts(instant, timeZone).weekday;
    if (trigger.weekdays.length > 0 && !trigger.weekdays.includes(weekday)) continue;

    /**
     * Heure inexistante au passage à l'heure d'été : 02:30 n'existe pas la nuit
     * où l'on saute de 02:00 à 03:00. `zonedTimeToUtc` renvoie alors un instant
     * dont l'heure locale diffère de celle demandée — on l'écarte plutôt que de
     * déclencher à une heure que l'utilisateur n'a pas choisie.
     */
    const check = zonedParts(instant, timeZone);
    if (check.hour !== hour || check.minute !== minute) continue;

    out.push(instant);
  }

  return out.sort((a, b) => a.getTime() - b.getTime());
}
