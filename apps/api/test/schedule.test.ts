import { describe, expect, it } from 'vitest';
import { occurrencesBetween, zonedParts, zonedTimeToUtc, zoneOffsetMs } from '../src/automations/schedule.js';

const PARIS = 'Europe/Paris';

describe('fuseau horaire', () => {
  it('applique le bon décalage été / hiver', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), PARIS)).toBe(3600_000);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), PARIS)).toBe(2 * 3600_000);
  });

  it('convertit une heure locale en instant UTC des deux côtés du changement d’heure', () => {
    expect(zonedTimeToUtc(2026, 1, 15, 23, 30, PARIS).toISOString()).toBe('2026-01-15T22:30:00.000Z');
    expect(zonedTimeToUtc(2026, 7, 15, 23, 30, PARIS).toISOString()).toBe('2026-07-15T21:30:00.000Z');
  });

  it('donne le jour de la semaine local, pas celui d’UTC', () => {
    // Dimanche 23:30 à Paris = dimanche 22:30 UTC : même jour ici.
    expect(zonedParts(new Date('2026-01-18T22:30:00Z'), PARIS).weekday).toBe(7);
    // Lundi 00:30 à Paris = dimanche 23:30 UTC : le jour local est lundi.
    expect(zonedParts(new Date('2026-01-18T23:30:00Z'), PARIS).weekday).toBe(1);
  });
});

describe('échéances', () => {
  const soir = { at: '23:30', weekdays: [] };

  it('trouve l’échéance du soir dans la fenêtre', () => {
    const found = occurrencesBetween(
      soir,
      new Date('2026-01-15T22:29:00Z'),
      new Date('2026-01-15T22:31:00Z'),
      PARIS,
    );
    expect(found.map((d) => d.toISOString())).toEqual(['2026-01-15T22:30:00.000Z']);
  });

  it('n’émet rien hors de la fenêtre', () => {
    expect(
      occurrencesBetween(soir, new Date('2026-01-15T10:00:00Z'), new Date('2026-01-15T10:01:00Z'), PARIS),
    ).toEqual([]);
  });

  it('exclut la borne gauche — un tick ne rejoue pas l’échéance du tick précédent', () => {
    const borne = new Date('2026-01-15T22:30:00Z');
    expect(occurrencesBetween(soir, borne, new Date('2026-01-15T22:31:00Z'), PARIS)).toEqual([]);
  });

  it('respecte les jours de la semaine', () => {
    const semaine = { at: '06:45', weekdays: [1, 2, 3, 4, 5] };
    // Samedi 17 janvier 2026.
    expect(
      occurrencesBetween(semaine, new Date('2026-01-17T05:44:00Z'), new Date('2026-01-17T05:46:00Z'), PARIS),
    ).toEqual([]);
    // Lundi 19 janvier 2026.
    expect(
      occurrencesBetween(semaine, new Date('2026-01-19T05:44:00Z'), new Date('2026-01-19T05:46:00Z'), PARIS),
    ).toHaveLength(1);
  });

  it('garde la même heure locale de part et d’autre du passage à l’heure d’été', () => {
    // Le changement a lieu dans la nuit du 28 au 29 mars 2026.
    const avant = occurrencesBetween(soir, new Date('2026-03-27T22:29:00Z'), new Date('2026-03-27T22:31:00Z'), PARIS);
    const apres = occurrencesBetween(soir, new Date('2026-03-30T21:29:00Z'), new Date('2026-03-30T21:31:00Z'), PARIS);
    expect(avant).toHaveLength(1);
    expect(apres).toHaveLength(1);
    // Deux instants UTC différents, la même heure locale : c'est exactement ce
    // qu'un planificateur naïf en UTC raterait.
    expect(zonedParts(avant[0]!, PARIS).hour).toBe(23);
    expect(zonedParts(apres[0]!, PARIS).hour).toBe(23);
  });

  it('n’invente pas une heure qui n’existe pas le jour du passage à l’heure d’été', () => {
    // Le 29 mars 2026 à Paris, on saute de 02:00 à 03:00 : 02:30 n'existe pas.
    const found = occurrencesBetween(
      { at: '02:30', weekdays: [] },
      new Date('2026-03-29T00:00:00Z'),
      new Date('2026-03-29T02:00:00Z'),
      PARIS,
    );
    expect(found).toEqual([]);
  });
});

describe('résumé en langage naturel', () => {
  const noms = new Map([['d1', 'Plafonnier'], ['d2', 'Volets']]);

  it('décrit une scène manuelle', async () => {
    const { buildSummary } = await import('../src/automations/summary.js');
    expect(
      buildSummary(
        {
          trigger: { kind: 'manual' },
          conditions: [],
          actions: [
            { kind: 'set', device_id: 'd1', target: { type: 'brightness', value: 15 } },
            { kind: 'set', device_id: 'd2', target: { type: 'position', value: 0 } },
          ],
        },
        noms,
      ),
    ).toBe('À la demande, Plafonnier à 15 % et Volets fermé.');
  });

  it('décrit un horaire en semaine avec condition', async () => {
    const { buildSummary } = await import('../src/automations/summary.js');
    expect(
      buildSummary(
        {
          trigger: { kind: 'schedule', at: '06:45', weekdays: [1, 2, 3, 4, 5] },
          conditions: [{ kind: 'time_range', from: '05:00', to: '09:00' }],
          actions: [{ kind: 'set', device_id: 'd1', target: { type: 'on_off', value: true } }],
        },
        noms,
      ),
    ).toBe('En semaine à 06:45, entre 05:00 et 09:00, Plafonnier allumé.');
  });

  it('ne montre jamais d’identifiant brut pour un appareil supprimé', async () => {
    const { buildSummary } = await import('../src/automations/summary.js');
    const texte = buildSummary(
      {
        trigger: { kind: 'manual' },
        conditions: [],
        actions: [{ kind: 'set', device_id: 'inconnu', target: { type: 'on_off', value: false } }],
      },
      new Map(),
    );
    expect(texte).toBe('À la demande, un appareil supprimé éteint.');
    expect(texte).not.toContain('inconnu');
  });
});

describe('conditions', () => {
  async function engine(state: Record<string, unknown> = {}) {
    const { AutomationEngine } = await import('../src/automations/engine.js');
    const { MemoryStateStore } = await import('../src/state/store.js');
    const store = new MemoryStateStore();
    for (const [device, value] of Object.entries(state)) {
      await store.set(device, value as never);
    }
    return new AutomationEngine({} as never, {} as never, store, {} as never);
  }

  it('accepte une plage horaire qui enjambe minuit', async () => {
    const e = await engine();
    const nuit = [{ kind: 'time_range' as const, from: '22:00', to: '06:00' }];
    // 23:30 heure de Paris en janvier = 22:30 UTC.
    expect(await e.conditionsMet(nuit, 'Europe/Paris', new Date('2026-01-15T22:30:00Z'))).toBe(true);
    // 14:00 heure de Paris.
    expect(await e.conditionsMet(nuit, 'Europe/Paris', new Date('2026-01-15T13:00:00Z'))).toBe(false);
  });

  it('compare l’état courant d’un appareil', async () => {
    const e = await engine({ d1: { type: 'on_off', value: true } });
    expect(
      await e.conditionsMet(
        [{ kind: 'device_state', device_id: 'd1', equals: { type: 'on_off', value: true } }],
        'Europe/Paris',
      ),
    ).toBe(true);
    expect(
      await e.conditionsMet(
        [{ kind: 'device_state', device_id: 'd1', equals: { type: 'on_off', value: false } }],
        'Europe/Paris',
      ),
    ).toBe(false);
  });

  it('refuse de déclencher sur la présence, faute de source de données', async () => {
    const e = await engine();
    // Mieux vaut ne rien faire que déclencher sur une information qu'on n'a pas.
    expect(await e.conditionsMet([{ kind: 'someone_home', value: true }], 'Europe/Paris')).toBe(false);
  });

  it('exige que toutes les conditions soient réunies', async () => {
    const e = await engine({ d1: { type: 'on_off', value: true } });
    expect(
      await e.conditionsMet(
        [
          { kind: 'device_state', device_id: 'd1', equals: { type: 'on_off', value: true } },
          { kind: 'someone_home', value: true },
        ],
        'Europe/Paris',
      ),
    ).toBe(false);
  });
});

describe('chiffrement des jetons tiers', () => {
  const CLE = 'Cq5tqhCPTiA8CbTQFkK4TcMkNbXXKrLKp9y0FWGkYVE=';

  it('fait un aller-retour sans perte', async () => {
    const { TokenCipher } = await import('../src/crypto/tokens.js');
    const cipher = new TokenCipher(CLE);
    const jeton = 'tuya-access-token-très-secret';
    expect(cipher.decrypt(cipher.encrypt(jeton))).toBe(jeton);
  });

  it('ne laisse pas le clair apparaître dans le chiffré', async () => {
    const { TokenCipher } = await import('../src/crypto/tokens.js');
    const cipher = new TokenCipher(CLE);
    const chiffre = Buffer.from(cipher.encrypt('MOTDEPASSE')).toString('utf8');
    expect(chiffre).not.toContain('MOTDEPASSE');
  });

  it('produit un chiffré différent à chaque fois (IV aléatoire)', async () => {
    const { TokenCipher } = await import('../src/crypto/tokens.js');
    const cipher = new TokenCipher(CLE);
    const a = Buffer.from(cipher.encrypt('même')).toString('hex');
    const b = Buffer.from(cipher.encrypt('même')).toString('hex');
    // Réutiliser un IV en GCM permet de retrouver le clair et de forger des messages.
    expect(a).not.toBe(b);
  });

  it('détecte une altération du chiffré', async () => {
    const { TokenCipher } = await import('../src/crypto/tokens.js');
    const cipher = new TokenCipher(CLE);
    const altere = Buffer.from(cipher.encrypt('jeton'));
    altere[altere.length - 1] = (altere.at(-1) ?? 0) ^ 0xff;
    // C'est l'apport de GCM : sans authentification, l'altération passerait.
    expect(() => cipher.decrypt(altere)).toThrow();
  });

  it('déchiffre avec une ancienne clé après rotation', async () => {
    const { TokenCipher } = await import('../src/crypto/tokens.js');
    const ancienne = new TokenCipher(`1:${CLE}`);
    const chiffreAncien = ancienne.encrypt('jeton-historique');

    const nouvelle = 'M0Xk1lQGxWQXcxXeQvUvVAZ7jvMbwZQ0ZQz5ynQzZ2E=';
    const apresRotation = new TokenCipher(`1:${CLE},2:${nouvelle}`);

    expect(apresRotation.currentVersion).toBe(2);
    // Les lignes déjà en base restent lisibles le temps du réencryptage.
    expect(apresRotation.decrypt(chiffreAncien)).toBe('jeton-historique');
    // Les nouvelles utilisent la clé courante.
    expect(apresRotation.versionOf(apresRotation.encrypt('x'))).toBe(2);
  });

  it('refuse une clé de mauvaise taille plutôt que de démarrer', async () => {
    const { TokenCipher } = await import('../src/crypto/tokens.js');
    expect(() => new TokenCipher('dHJvcCBjb3VydA==')).toThrow(/32 attendus/);
  });
});

describe('état OAuth', () => {
  it('ne peut être consommé qu’une fois', async () => {
    const { MemoryTempStore } = await import('../src/state/temp.js');
    const store = new MemoryTempStore();
    await store.put('oauth:abc', 'charge', 60);
    expect(await store.take('oauth:abc')).toBe('charge');
    // Un état rejouable permettrait de rattacher un compte deux fois.
    expect(await store.take('oauth:abc')).toBeNull();
  });

  it('expire', async () => {
    const { MemoryTempStore } = await import('../src/state/temp.js');
    const store = new MemoryTempStore();
    await store.put('k', 'v', 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.take('k')).toBeNull();
  });
});

describe('connecteur Tuya', () => {
  /** Transport factice : le connecteur ne doit rien savoir de HTTP. */
  function fakeTransport(routes: Record<string, unknown>) {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    return {
      calls,
      request: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        calls.push({ method, path, body });
        const key = Object.keys(routes).find((pattern) => path.includes(pattern));
        if (!key) throw new Error(`route non simulée : ${path}`);
        return routes[key] as T;
      },
    };
  }

  const REF = {
    deviceId: '11111111-1111-4111-8111-111111111111',
    externalId: 'bf1a2b3c',
    unitId: null,
    accountId: '22222222-2222-4222-8222-222222222222',
  };

  const SPECS = {
    category: 'cz',
    functions: [
      { code: 'switch_1', type: 'Boolean', values: '{}' },
      // Bornes atypiques : 0-100 au lieu du 10-1000 habituel.
      { code: 'bright_value_v2', type: 'Integer', values: '{"min":0,"max":100,"scale":0,"step":1}' },
    ],
    status: [{ code: 'cur_power', type: 'Integer', values: '{"min":0,"max":50000,"scale":1}' }],
  };

  it('lit les bornes réelles de l’appareil plutôt que de les deviner', async () => {
    const { parseSpecifications } = await import('../src/devices/tuya/connector.js');
    expect(parseSpecifications(SPECS)).toEqual({
      // Sans bornes, mais retenu : sa présence dit que cet appareil se commande
      // par `switch_1`, et non par le `switch_led` des ampoules. L'écarter
      // faisait partir la commande sur un code que la prise ignore — acquittée
      // par le fournisseur, sans le moindre effet.
      switch_1: {},
      bright_value_v2: { min: 0, max: 100, scale: 0, step: 1 },
      cur_power: { min: 0, max: 50000, scale: 1 },
    });
  });

  it('convertit la commande vers l’échelle déclarée par l’appareil', async () => {
    const { TuyaConnector } = await import('../src/devices/tuya/connector.js');
    const transport = fakeTransport({ specifications: SPECS, commands: { success: true } });
    const connector = new TuyaConnector(transport, async () => 'jeton', async () => []);

    await connector.sendCommand(REF, { type: 'brightness', value: 50 });

    const commande = transport.calls.find((c) => c.path.includes('commands'));
    // Avec les bornes 0-100 de cet appareil, 50 % vaut 50 — pas 500 comme le
    // donnerait l'échelle 10-1000 par défaut.
    expect(commande?.body).toEqual({ commands: [{ code: 'bright_value_v2', value: 50 }] });
  });

  it('traduit l’état lu en capacités du contrat', async () => {
    const { TuyaConnector } = await import('../src/devices/tuya/connector.js');
    const { capabilityValue } = await import('@domotique/contract');
    const transport = fakeTransport({
      specifications: SPECS,
      status: [
        { code: 'switch_1', value: true },
        { code: 'cur_power', value: 423 },
        // Data Point inconnu : ignoré plutôt que deviné.
        { code: 'countdown_1', value: 0 },
      ],
    });
    const connector = new TuyaConnector(transport, async () => 'jeton', async () => []);

    const values = await connector.getState(REF);
    expect(values).toEqual([
      { type: 'on_off', value: true },
      { type: 'power', value: 42.3 },
    ]);
    for (const value of values) expect(capabilityValue.safeParse(value).success).toBe(true);
  });

  it('n’émet un événement que sur un vrai changement', async () => {
    const { TuyaConnector } = await import('../src/devices/tuya/connector.js');
    const transport = fakeTransport({
      specifications: SPECS,
      status: [{ code: 'switch_1', value: true }],
    });
    const connector = new TuyaConnector(transport, async () => 'jeton', async () => [REF]);

    const events: unknown[] = [];
    connector.onStateChange((event) => events.push(event.value));

    await connector.poll();
    await connector.poll();
    // Deux scrutations, une seule transition : sinon chaque tour réécrirait
    // l'historique et republierait des événements identiques.
    expect(events).toHaveLength(1);
  });

  it('déclare la bonne sémantique d’accusé de réception', async () => {
    const { TuyaConnector } = await import('../src/devices/tuya/connector.js');
    const connector = new TuyaConnector(fakeTransport({}), async () => '', async () => []);
    // Tuya accuse réception de la requête, pas de l'exécution : `DeviceService`
    // doit le savoir pour ne pas marquer la commande confirmée trop tôt.
    expect(connector.ackSemantics).toBe('gateway');
    expect(connector.protocol).toBe('tuya');
  });

  it('refuse une commande sur un appareil sans compte rattaché', async () => {
    const { TuyaConnector } = await import('../src/devices/tuya/connector.js');
    const connector = new TuyaConnector(fakeTransport({}), async () => '', async () => []);
    await expect(
      connector.sendCommand({ ...REF, accountId: null }, { type: 'on_off', value: true }),
    ).rejects.toThrow();
  });
});

describe('budget d’appels tiers', () => {
  async function budget(limits?: { perAccount: number; global: number; windowS: number }) {
    const { CallBudget } = await import('../src/integrations/budget.js');
    const { MemoryRateLimiter } = await import('../src/state/pairing.js');
    return new CallBudget(new MemoryRateLimiter(), 'tuya', limits);
  }

  it('protège les autres comptes quand l’un s’emballe', async () => {
    const b = await budget({ perAccount: 2, global: 100, windowS: 60 });
    expect(await b.reserve('compte-a')).toBeNull();
    expect(await b.reserve('compte-a')).toBeNull();
    // Le compte A a épuisé sa part…
    expect(await b.reserve('compte-a')).toBeGreaterThan(0);
    // …mais le compte B n'en pâtit pas.
    expect(await b.reserve('compte-b')).toBeNull();
  });

  it('coupe globalement avant la facture', async () => {
    const b = await budget({ perAccount: 100, global: 2, windowS: 60 });
    await b.reserve('a');
    await b.reserve('b');
    // Le quota d'un projet Tuya est global : dépasser le plafond de la
    // plateforme est plus grave que le dépassement d'un compte.
    expect(await b.reserve('c')).toBeGreaterThan(0);
  });

  it('lève avec le délai d’attente sur une action utilisateur', async () => {
    const b = await budget({ perAccount: 1, global: 10, windowS: 60 });
    await b.require('a');
    await expect(b.require('a')).rejects.toMatchObject({
      code: 'connector_quota_exceeded',
    });
  });
});

describe('scrutation Tuya', () => {
  it('reste éteinte tant qu’aucun intervalle n’est configuré', async () => {
    const { TuyaConnector } = await import('../src/devices/tuya/connector.js');
    let appels = 0;
    const connector = new TuyaConnector(
      { request: async () => { appels += 1; return [] as never; } },
      async () => 'jeton',
      async () => [{ deviceId: 'd', externalId: 'x', unitId: null, accountId: 'a' }],
      // Défaut : pas de scrutation. Chaque lecture consomme le quota du projet.
    );
    connector.onStateChange(() => {});
    await new Promise((r) => setTimeout(r, 30));
    expect(appels).toBe(0);
  });
});
