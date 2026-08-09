/**
 * Diagnostic du connecteur Tuya.
 *
 * Distingue les trois causes d'échec qui se ressemblent depuis l'application :
 * identifiants faux, région incohérente, IP non autorisée. Utile aussi au
 * support, une fois en production.
 */
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

import { loadEnv } from '../src/env.js';
import { TuyaClient } from '../src/devices/tuya/client.js';

const env = loadEnv();

if (!env.TUYA_ACCESS_ID || !env.TUYA_ACCESS_SECRET) {
  console.log('✗ TUYA_ACCESS_ID / TUYA_ACCESS_SECRET absents de .env');
  process.exit(1);
}

console.log('Data center :', env.TUYA_DATA_CENTER);
console.log('Access ID   :', env.TUYA_ACCESS_ID.slice(0, 6) + '…');

const client = new TuyaClient({
  accessId: env.TUYA_ACCESS_ID,
  accessSecret: env.TUYA_ACCESS_SECRET,
  dataCenter: env.TUYA_DATA_CENTER,
});

/**
 * Centres de données Tuya.
 *
 * Le libellé de la console ne suffit pas : « Western Europe Data Center »
 * correspond à `openapi-weaz.tuyaeu.com`, pas à `openapi.tuyaeu.com`. Le mauvais
 * endpoint renvoie un 1114 qui parle d'adresse IP — un message qui envoie
 * chercher très loin de la vraie cause. D'où ce balayage automatique.
 */
const CENTRES: Record<string, string> = {
  'Europe (weaz)': 'https://openapi-weaz.tuyaeu.com',
  'Europe': 'https://openapi.tuyaeu.com',
  'Amérique Ouest': 'https://openapi.tuyaus.com',
  'Amérique Est': 'https://openapi-ueaz.tuyaus.com',
  'Chine': 'https://openapi.tuyacn.com',
  'Inde': 'https://openapi.tuyain.com',
};

async function trouverLeBonCentre(): Promise<string | null> {
  for (const [nom, url] of Object.entries(CENTRES)) {
    if (url === env.TUYA_DATA_CENTER) continue;
    const candidat = new TuyaClient({
      accessId: env.TUYA_ACCESS_ID,
      accessSecret: env.TUYA_ACCESS_SECRET,
      dataCenter: url,
    });
    try {
      await candidat.checkCredentials();
      console.log(`  → Le projet répond sur « ${nom} » : ${url}`);
      return url;
    } catch {
      // Ce centre ne connaît pas le projet : on continue.
    }
  }
  return null;
}

/**
 * Deux vérifications distinctes, et c'est le point important.
 *
 * L'obtention du jeton ne consomme pas le pack de ressources : elle réussit même
 * quand l'abonnement au service est suspendu. Un diagnostic qui s'arrête là
 * annonce « tout va bien » alors qu'aucun appel sur un appareil ne passera.
 */
async function verifierAccesAppareils(): Promise<void> {
  await client.request('GET', '/v1.0/iot-01/associated-users/devices?size=1');
}

try {
  const { expiresInS } = await client.checkCredentials();
  console.log(`✓ Authentification du projet — jeton valable ${expiresInS} s`);

  try {
    await verifierAccesAppareils();
    console.log('✓ API appareils accessible — tout est opérationnel');
  } catch (error) {
    console.log('✗ API appareils :', (error as Error).message.slice(0, 120));
    console.log('');
    console.log('  L’authentification passe mais les appels sur les appareils sont refusés.');
    console.log('  Console Tuya → Cloud → IoT Core → My Subscriptions :');
    console.log('  la ligne « Cloud Develop Base Resource Trial » doit être « In service ».');
    process.exit(1);
  }
} catch (error) {
  const message = (error as Error).message;
  console.log('✗', message);

  // L'IP figure dans le message d'erreur de Tuya : c'est l'adresse qu'il voit
  // réellement, plus fiable qu'un service tiers de détection d'IP.
  console.log('');
  console.log('Recherche du bon centre de données…');
  const bon = await trouverLeBonCentre();
  if (bon) {
    console.log('');
    console.log(`  Corriger dans .env :  TUYA_DATA_CENTER="${bon}"`);
  } else {
    // Aucun centre ne connaît le projet : la cause est ailleurs.
    const ip = message.match(/your ip\(([^)]+)\)/)?.[1];
    console.log('  Aucun centre ne reconnaît ce projet.');
    if (ip) {
      console.log(`  → Vérifier l'allowlist du projet pour l'IP ${ip},`);
      console.log("     ou l'onglet « API de service » (services souscrits).");
    }
  }
  if (message.includes('sign invalid')) {
    console.log('  → Access Secret incorrect, ou data center différent de celui du projet.');
  }
  process.exit(1);
}
