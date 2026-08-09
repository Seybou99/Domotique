import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { parseKeyRing } from './crypto/tokens.js';

/**
 * Chargement du `.env` local.
 *
 * Il était jusqu'ici chargé par effet de bord à l'import de `@prisma/client` :
 * tout script n'important pas Prisma démarrait donc sans configuration. On le
 * fait explicitement, une bonne fois. En production, les variables viennent du
 * coffre-fort de secrets et aucun fichier n'est présent.
 */
function loadDotEnvOnce() {
  const path = resolve(process.cwd(), '.env');
  if (process.env.NODE_ENV === 'production' || !existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // Fichier illisible ou malformé : la validation ci-dessous dira ce qui manque.
  }
}

/**
 * Configuration (CDC §10).
 *
 * Validée au démarrage : un secret manquant fait échouer le boot plutôt que la
 * première requête qui en a besoin, à 3 h du matin.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Racine publique du backend — sert à composer les URL de redirection OAuth. */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /**
   * URL de redirection du flux OAuth tiers.
   *
   * En développement, on redirige vers le schéma de l'application
   * (`domotique://oauth`) pour utiliser la session d'authentification du
   * système — plus sûre qu'une WebView embarquée. En production, elle doit
   * correspondre exactement à l'URL déclarée chez le fournisseur.
   */
  OAUTH_REDIRECT_URI: z.string().default(''),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),

  /** Vide = store d'état en mémoire (développement mono-instance). */
  REDIS_URL: z.string().default(''),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_S: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_S: z.coerce.number().int().positive().default(2_592_000),

  /**
   * Clé(s) de chiffrement des jetons OAuth tiers — 32 octets en base64.
   * Validée ici, et pas seulement à la première utilisation : une clé mal
   * formée doit faire échouer le démarrage, pas la première liaison de compte.
   */
  TOKEN_ENCRYPTION_KEY: z.string().min(1).superRefine((value, ctx) => {
    try {
      parseKeyRing(value);
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
    }
  }),

  TUYA_ACCESS_ID: z.string().default(''),
  TUYA_ACCESS_SECRET: z.string().default(''),
  /**
   * Endpoint régional Tuya. Piège vérifié en conditions réelles : le libellé
   * « Western Europe Data Center » de la console correspond à
   * `openapi-weaz.tuyaeu.com`, **pas** à `openapi.tuyaeu.com`. Le mauvais
   * endpoint renvoie une erreur 1114 parlant d'adresse IP non autorisée, ce qui
   * envoie chercher très loin de la vraie cause.
   * `npm run tuya:check` teste tous les centres et indique le bon.
   */
  TUYA_DATA_CENTER: z.string().default('https://openapi-weaz.tuyaeu.com'),

  /**
   * Intervalle de scrutation des appareils Tuya, en secondes. **0 = désactivée**,
   * et c'est le défaut : chaque lecture consomme le pack de ressources du projet,
   * dont l'essai gratuit plafonne à 0,20 USD par mois. À n'activer que le temps
   * d'un test, jusqu'à ce que l'abonnement au Message Service remplace la
   * scrutation par un vrai flux d'événements (CDC §6.2).
   */
  TUYA_POLL_INTERVAL_S: z.coerce.number().int().min(0).default(0),

  MQTT_BROKER_URL: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) loadDotEnvOnce();
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide (voir .env.example) :\n${details}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    // Les secrets d'exemple ne doivent jamais atteindre la production.
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (parsed.data[key].startsWith('dev-only')) {
        throw new Error(`${key} est resté à sa valeur de développement.`);
      }
    }
  }
  return parsed.data;
}
