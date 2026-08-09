import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement au repos des jetons OAuth tiers (CDC §7).
 *
 * AES-256-GCM : chiffre **et** authentifie. Un mode sans authentification
 * laisserait un attaquant ayant accès à la base modifier le chiffré sans être
 * détecté ; ici, toute altération fait échouer le déchiffrement.
 *
 * Format stocké : `version(1) || iv(12) || tag(16) || chiffré`.
 * La version de clé est dans les octets eux-mêmes **et** dans la colonne
 * `keyVersion` : la colonne permet de retrouver les lignes à réencrypter sans
 * lire chaque valeur, l'octet garantit qu'on déchiffre avec la bonne clé même
 * si la colonne se désynchronise.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type KeyRing = Map<number, Buffer>;

/**
 * Construit le trousseau à partir de la configuration.
 * `TOKEN_ENCRYPTION_KEY` accepte plusieurs clés (`1:base64,2:base64`) pour
 * permettre une rotation : on chiffre avec la plus récente, on déchiffre avec
 * n'importe laquelle.
 */
export function parseKeyRing(raw: string): { keys: KeyRing; currentVersion: number } {
  const keys: KeyRing = new Map();

  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [versionText, material] = entry.includes(':') ? entry.split(':') : ['1', entry];
    const version = Number(versionText);
    const key = Buffer.from(material!, 'base64');
    if (!Number.isInteger(version) || version < 1 || version > 255) {
      throw new Error(`TOKEN_ENCRYPTION_KEY : version de clé invalide « ${versionText} »`);
    }
    if (key.length !== 32) {
      throw new Error(
        `TOKEN_ENCRYPTION_KEY : la clé ${version} fait ${key.length} octets, 32 attendus (base64 de 32 octets)`,
      );
    }
    keys.set(version, key);
  }

  if (keys.size === 0) throw new Error('TOKEN_ENCRYPTION_KEY est vide');
  return { keys, currentVersion: Math.max(...keys.keys()) };
}

export class TokenCipher {
  private readonly keys: KeyRing;
  readonly currentVersion: number;

  constructor(raw: string) {
    const { keys, currentVersion } = parseKeyRing(raw);
    this.keys = keys;
    this.currentVersion = currentVersion;
  }

  /**
   * Renvoie `Uint8Array<ArrayBuffer>` et non `Buffer` : c'est le type exact des
   * colonnes `Bytes` de Prisma. Avec les définitions Node récentes,
   * `Buffer<ArrayBufferLike>` n'est pas assignable — le tampon pourrait être
   * partagé (`SharedArrayBuffer`), ce que Prisma n'accepte pas.
   */
  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const key = this.keys.get(this.currentVersion)!;
    // IV aléatoire à chaque chiffrement : réutiliser un IV en GCM permet de
    // retrouver le clair et de forger des messages.
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Uint8Array.from(
      Buffer.concat([Buffer.from([this.currentVersion]), iv, cipher.getAuthTag(), encrypted]),
    );
  }

  decrypt(input: Uint8Array): string {
    const payload = Buffer.from(input);
    if (payload.length < 1 + IV_LENGTH + TAG_LENGTH) {
      throw new Error('Jeton chiffré tronqué');
    }
    const version = payload[0]!;
    const key = this.keys.get(version);
    if (!key) throw new Error(`Aucune clé de version ${version} dans le trousseau`);

    const iv = payload.subarray(1, 1 + IV_LENGTH);
    const tag = payload.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const encrypted = payload.subarray(1 + IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  /** Version de clé d'une valeur stockée, sans la déchiffrer. */
  versionOf(payload: Uint8Array): number {
    return payload[0] ?? 0;
  }
}

/** Génère une clé prête à coller dans la configuration. */
export function generateKey(): string {
  return randomBytes(32).toString('base64');
}
