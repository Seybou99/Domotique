import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyRequest } from 'fastify';
import { unauthorized } from './errors.js';
import type { Env } from '../env.js';

/** `promisify` ne retient pas la surcharge avec options : on l'enveloppe à la main. */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Authentification applicative (CDC §3, §7).
 *
 * Mots de passe hachés avec scrypt : dérivation lente, disponible dans `node:crypto`,
 * donc sans dépendance native à compiler — un binding natif cassé est la première
 * cause d'un backend qui ne démarre pas après une mise à jour.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  // Comparaison à temps constant : une comparaison naïve fuit la longueur du
  // préfixe correct et rend le hash attaquable par mesure de temps.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Seul le hash du refresh token est stocké — un dump de base ne donne pas de session. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type AccessClaims = { sub: string; typ: 'access' };
export type RefreshClaims = { sub: string; typ: 'refresh'; jti: string };

export function createAuth(env: Env) {
  function signAccess(userId: string): string {
    return jwt.sign({ sub: userId, typ: 'access' } satisfies AccessClaims, env.JWT_SECRET, {
      expiresIn: env.ACCESS_TOKEN_TTL_S,
    });
  }

  function signRefresh(userId: string, jti: string): string {
    return jwt.sign(
      { sub: userId, typ: 'refresh', jti } satisfies RefreshClaims,
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.REFRESH_TOKEN_TTL_S },
    );
  }

  /**
   * Deux secrets distincts, et un champ `typ` vérifié : sans lui, un refresh
   * token — à durée de vie longue — pourrait être présenté comme un access token.
   */
  function verifyAccess(token: string): AccessClaims {
    const claims = jwt.verify(token, env.JWT_SECRET) as AccessClaims;
    if (claims.typ !== 'access') throw unauthorized('Type de jeton incorrect');
    return claims;
  }

  function verifyRefresh(token: string): RefreshClaims {
    const claims = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshClaims;
    if (claims.typ !== 'refresh') throw unauthorized('Type de jeton incorrect');
    return claims;
  }

  function requireUser(req: FastifyRequest): string {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    try {
      return verifyAccess(header.slice(7)).sub;
    } catch {
      throw unauthorized('Jeton invalide ou expiré');
    }
  }

  return { signAccess, signRefresh, verifyAccess, verifyRefresh, requireUser };
}

export type Auth = ReturnType<typeof createAuth>;
