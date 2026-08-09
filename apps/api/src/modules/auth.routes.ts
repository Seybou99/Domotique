import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { auth as authApi } from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { AppError, conflict, unauthorized } from '../http/errors.js';
import { hashPassword, hashToken, verifyPassword } from '../http/auth.js';

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, auth, env } = ctx;

  async function issueTokens(userId: string, userAgent?: string) {
    const jti = randomUUID();
    const refreshToken = auth.signRefresh(userId, jti);
    await prisma.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: hashToken(refreshToken),
        userAgent: userAgent ?? null,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_S * 1000),
      },
    });
    return {
      access_token: auth.signAccess(userId),
      refresh_token: refreshToken,
      expires_in: env.ACCESS_TOKEN_TTL_S,
    };
  }

  const toUser = (u: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    createdAt: Date;
  }) => ({
    id: u.id,
    email: u.email,
    display_name: u.displayName,
    avatar_url: u.avatarUrl,
    created_at: u.createdAt.toISOString(),
  });

  registerRoute(app, ctx, authApi.signup, async ({ body, req }) => {
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('Un compte existe déjà pour cette adresse');

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName: body.display_name,
      },
    });
    return { user: toUser(user), tokens: await issueTokens(user.id, req.headers['user-agent']) };
  });

  registerRoute(app, ctx, authApi.login, async ({ body, req }) => {
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Message identique dans les deux cas : distinguer « compte inconnu » de
    // « mot de passe faux » permettrait d'énumérer les comptes existants.
    const invalid = unauthorized('Adresse e-mail ou mot de passe incorrect');
    if (!user) {
      // Hachage à vide malgré tout, pour que le temps de réponse ne trahisse pas
      // l'existence du compte.
      await verifyPassword(body.password, 'scrypt$16384$8$1$AAAA$AAAA');
      throw invalid;
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) throw invalid;

    return { user: toUser(user), tokens: await issueTokens(user.id, req.headers['user-agent']) };
  });

  registerRoute(app, ctx, authApi.refresh, async ({ body, req }) => {
    let claims;
    try {
      claims = auth.verifyRefresh(body.refresh_token);
    } catch {
      throw unauthorized('Jeton de rafraîchissement invalide');
    }

    const stored = await prisma.refreshToken.findUnique({ where: { id: claims.jti } });
    if (!stored || stored.revokedAt || stored.tokenHash !== hashToken(body.refresh_token)) {
      throw unauthorized('Session révoquée');
    }
    if (stored.expiresAt < new Date()) throw unauthorized('Session expirée');

    // Rotation : l'ancien jeton est révoqué à l'usage. Sa réapparition signale un
    // vol de jeton — à traiter en révoquant toute la famille de sessions.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return { tokens: await issueTokens(claims.sub, req.headers['user-agent']) };
  });

  registerRoute(app, ctx, authApi.logout, async ({ body }) => {
    try {
      const claims = auth.verifyRefresh(body.refresh_token);
      await prisma.refreshToken.updateMany({
        where: { id: claims.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Une déconnexion avec un jeton déjà invalide reste un succès : l'objectif
      // de l'appelant — ne plus avoir de session — est atteint.
    }
    return { ok: true as const };
  });

  registerRoute(app, ctx, authApi.me, async ({ userId }) => {
    const user = await prisma.user.findUnique({ where: { id: userId! } });
    if (!user) throw new AppError('unauthorized', 'Compte supprimé');
    return { user: toUser(user) };
  });
}
