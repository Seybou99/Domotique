/**
 * Vérification bout en bout des modules `integrations` et `alerts`.
 *
 * Le flux OAuth est déroulé avec le fournisseur simulé (enregistré sous `hue`,
 * dont le connecteur réel arrive en V2) : le parcours complet est ainsi testable
 * sans dépendre d'un tiers, et sans qu'un faux compte passe pour un vrai Tuya.
 */
import { loadEnv } from '../src/env.js';
import { createContext } from '../src/context.js';
import { buildServer } from '../src/server.js';

const ctx = createContext(loadEnv());
const app = await buildServer(ctx);
const json = (r: { json: () => any }) => r.json();

const email = `integ-${Date.now()}@example.com`;
const signup = json(
  await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email, password: 'un-mot-de-passe-solide', display_name: 'Camille' },
  }),
);
const auth = { authorization: `Bearer ${signup.tokens.access_token}` };
const home = json(
  await app.inject({
    method: 'POST',
    url: '/v1/homes',
    headers: auth,
    payload: { name: 'Maison des Lilas', timezone: 'Europe/Paris' },
  }),
).home;

// ── liaison de compte
const oauth = json(
  await app.inject({
    method: 'GET',
    url: `/v1/homes/${home.id}/integrations/hue/oauth-url`,
    headers: auth,
  }),
);
console.log('1. URL d’autorisation→', oauth.url.slice(0, 58) + '…');

const mauvaisEtat = await app.inject({
  method: 'POST',
  url: `/v1/homes/${home.id}/integrations/hue/callback`,
  headers: auth,
  payload: { code: 'simule-xxxx', state: 'etat-forge' },
});
console.log('2. état forgé (CSRF) →', mauvaisEtat.statusCode, '/', json(mauvaisEtat).error.code);

const code = new URL(oauth.url).searchParams.get('code')!;
const account = json(
  await app.inject({
    method: 'POST',
    url: `/v1/homes/${home.id}/integrations/hue/callback`,
    headers: auth,
    payload: { code, state: oauth.state },
  }),
).account;
console.log('3. compte lié        →', account.account_label, '| provider:', account.provider);
console.log('4. jetons dans la réponse →',
  'access_token' in account || 'refresh_token' in account ? 'FUITE !' : 'aucun (correct)');

const enBase = await ctx.prisma.thirdPartyAccount.findUnique({ where: { id: account.id } });
const brut = Buffer.from(enBase!.accessTokenEnc).toString('utf8');
console.log('5. jetons en base    →', brut.startsWith('acc-') ? 'EN CLAIR !' : `chiffrés (v${enBase!.keyVersion})`);

const rejeuEtat = await app.inject({
  method: 'POST',
  url: `/v1/homes/${home.id}/integrations/hue/callback`,
  headers: auth,
  payload: { code, state: oauth.state },
});
console.log('6. état rejoué       →', rejeuEtat.statusCode, '/', json(rejeuEtat).error.code);

// ── découverte et import
const found = json(
  await app.inject({ method: 'GET', url: `/v1/integrations/${account.id}/discover`, headers: auth }),
);
console.log('7. appareils trouvés →', found.items.map((d: any) => `${d.name}${d.supported ? '' : ' (non pris en charge)'}`).join(', '));

const imported = json(
  await app.inject({
    method: 'POST',
    url: `/v1/integrations/${account.id}/import`,
    headers: auth,
    payload: { external_ids: ['sim-lampe-1', 'sim-prise-1'] },
  }),
);
console.log('8. import            →', imported.devices.length, 'appareils |',
  imported.devices[0].name, '→', imported.devices[0].capabilities.map((c: any) => c.type).join(', '));

const refusNonSupporte = await app.inject({
  method: 'POST',
  url: `/v1/integrations/${account.id}/import`,
  headers: auth,
  payload: { external_ids: ['sim-exotique-1'] },
});
console.log('9. import non supporté→', refusNonSupporte.statusCode, '/', json(refusNonSupporte).error.code);

// ── alertes
await ctx.prisma.alert.createMany({
  data: [
    { homeId: home.id, category: 'security', severity: 'warning', title: 'Porte-fenêtre ouverte' },
    { homeId: home.id, category: 'safety', severity: 'critical', title: 'Fuite détectée' },
    { homeId: home.id, category: 'activity', severity: 'info', title: 'Scène exécutée', read: true },
  ],
});
const fil = json(
  await app.inject({ method: 'GET', url: `/v1/homes/${home.id}/alerts`, headers: auth }),
);
console.log('10. fil d’alertes    →', fil.items.length, 'alertes |', fil.unread_count, 'non lues');

const filtre = json(
  await app.inject({
    method: 'GET',
    url: `/v1/homes/${home.id}/alerts?category=safety&unread_only=true`,
    headers: auth,
  }),
);
console.log('11. filtre catégorie →', filtre.items.map((a: any) => a.title).join(', '));

await app.inject({ method: 'POST', url: `/v1/homes/${home.id}/alerts/read-all`, headers: auth });
const apresLecture = json(
  await app.inject({ method: 'GET', url: `/v1/homes/${home.id}/alerts`, headers: auth }),
);
console.log('12. tout marquer lu  →', apresLecture.unread_count, 'non lues');

const reglages = json(
  await app.inject({
    method: 'PATCH',
    url: `/v1/homes/${home.id}/notifications/settings`,
    headers: auth,
    payload: { by_category: { activity: { push: true, email: false } }, quiet_hours: { from: '22:00', to: '07:00' } },
  }),
).settings;
console.log('13. réglages         → activity.push:', reglages.by_category.activity.push,
  '| security conservé:', reglages.by_category.security.push,
  '| heures calmes:', reglages.quiet_hours.from);

// ── déliaison
const unlink = await app.inject({
  method: 'DELETE',
  url: `/v1/integrations/${account.id}`,
  headers: auth,
  payload: { devices: 'delete' },
});
const restants = await ctx.prisma.device.count({ where: { homeId: home.id } });
console.log('14. déliaison        →', unlink.statusCode, '| appareils restants:', restants);

await ctx.prisma.user.deleteMany({ where: { email } });
await ctx.prisma.home.deleteMany({ where: { id: home.id } });
console.log('15. nettoyage        → données de test supprimées');

await app.close();
await ctx.close();
