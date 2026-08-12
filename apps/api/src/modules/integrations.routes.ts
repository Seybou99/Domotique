import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  integrations as integrationsApi,
  type Protocol,
  type ThirdPartyAccount,
} from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { AppError, conflict, notFound } from '../http/errors.js';

/**
 * Comptes tiers (CDC §6.2, écrans 2.7, 2.8 et 5.3).
 *
 * Deux invariants tenus par ce module :
 *  - aucun jeton ne franchit le contrat — le schéma `thirdPartyAccount` n'en
 *    déclare aucun, et la validation de sortie les retirerait de toute façon ;
 *  - aucun jeton n'est stocké en clair — voir `TokenCipher`.
 */

/** Durée de vie de l'état anti-CSRF : le temps d'un parcours en WebView. */
const STATE_TTL_S = 600;

export function registerIntegrationRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, access, providers, cipher, temp, events, accounts } = ctx;

  const redirectUri = () =>
    ctx.env.OAUTH_REDIRECT_URI || `${ctx.env.PUBLIC_URL}/v1/integrations/callback`;

  const toAccount = (a: {
    id: string;
    homeId: string;
    provider: string;
    accountLabel: string;
    linkedByUserId: string;
    linkedAt: Date;
    reauthRequired: boolean;
    _count?: { devices: number };
  }): ThirdPartyAccount => ({
    id: a.id,
    home_id: a.homeId,
    provider: a.provider as Exclude<Protocol, 'zigbee'>,
    account_label: a.accountLabel,
    linked_by_user_id: a.linkedByUserId,
    linked_at: a.linkedAt.toISOString(),
    reauth_required: a.reauthRequired,
    device_count: a._count?.devices ?? 0,
  });

  function requireProvider(name: string) {
    const provider = ctx.providers.get(name);
    if (!provider) {
      throw new AppError(
        'validation_failed',
        `Écosystème « ${name} » non activé sur ce serveur (disponibles : ${providers.available().join(', ') || 'aucun'})`,
      );
    }
    return provider;
  }

  registerRoute(app, ctx, integrationsApi.list, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id);
    const rows = await prisma.thirdPartyAccount.findMany({
      where: { homeId: params.home_id },
      include: { _count: { select: { devices: true } } },
      orderBy: { linkedAt: 'asc' },
    });
    return { items: rows.map(toAccount) };
  });

  registerRoute(app, ctx, integrationsApi.oauthUrl, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id, 'admin');
    const provider = requireProvider(params.provider);

    /**
     * L'état lie l'URL d'autorisation au foyer et à l'utilisateur qui l'a
     * demandée. Sans lui, un tiers pourrait faire compléter le flux par la
     * victime et rattacher **son** compte au foyer de l'attaquant.
     */
    const state = randomBytes(24).toString('base64url');
    await temp.put(
      `oauth:${state}`,
      JSON.stringify({ homeId: params.home_id, userId, provider: params.provider }),
      STATE_TTL_S,
    );

    return {
      url: provider.authorizationUrl(state, redirectUri()),
      state,
      redirect_uri: redirectUri(),
    };
  });

  /**
   * Liaison d'un écosystème relié hors application (Tuya).
   *
   * Aucun jeton n'est stocké : les appels se font avec les identifiants du
   * projet. On enregistre le rattachement pour que le foyer sache que
   * l'écosystème est disponible et pour porter les appareils importés.
   */
  registerRoute(app, ctx, integrationsApi.link, async ({ userId, params, body }) => {
    await access.requireHome(userId!, params.home_id, 'admin');
    const provider = requireProvider(params.provider);

    if (provider.linkMode !== 'console') {
      throw new AppError(
        'validation_failed',
        `${params.provider} se relie depuis l’application — utiliser le flux d’autorisation`,
      );
    }

    const label = body.label ?? 'Compte lié en console';
    const existing = await prisma.thirdPartyAccount.findFirst({
      where: { homeId: params.home_id, provider: params.provider as Protocol },
      include: { _count: { select: { devices: true } } },
    });
    if (existing) return { account: toAccount(existing) };

    const account = await prisma.thirdPartyAccount.create({
      data: {
        homeId: params.home_id,
        provider: params.provider as Protocol,
        accountLabel: label,
        linkedByUserId: userId!,
        // Colonnes obligatoires du schéma : on y met du vide chiffré plutôt que
        // de rendre les colonnes nullables pour un seul mode de liaison.
        accessTokenEnc: cipher.encrypt(''),
        refreshTokenEnc: cipher.encrypt(''),
        keyVersion: cipher.currentVersion,
        // Pas d'expiration : rien à renouveler.
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        reauthRequired: false,
      },
      include: { _count: { select: { devices: true } } },
    });
    return { account: toAccount(account) };
  });

  /**
   * Identifiants du compte technique du SDK natif.
   *
   * Émis une fois puis relus : c'est ce qui fait qu'une réinstallation de
   * l'application retrouve les appareils déjà appairés. Le mot de passe est
   * chiffré au repos — il donne accès à ces appareils.
   */
  registerRoute(app, ctx, integrationsApi.appCredentials, async ({ userId, params }) => {
    const existing = await prisma.nativeSdkAccount.findUnique({
      where: { userId_provider: { userId: userId!, provider: params.provider as Protocol } },
    });
    if (existing) {
      return {
        uid: existing.uid,
        password: cipher.decrypt(existing.passwordEnc),
        country_code: existing.countryCode,
      };
    }

    // L'identifiant dérive de celui de l'utilisateur : stable, non devinable
    // depuis l'extérieur, et sans lien lisible avec son adresse e-mail.
    const uid = `lumo-${createHash('sha256').update(`${userId}:${params.provider}`).digest('hex').slice(0, 24)}`;
    const password = randomBytes(24).toString('base64url');

    const created = await prisma.nativeSdkAccount.create({
      data: {
        userId: userId!,
        provider: params.provider as Protocol,
        uid,
        passwordEnc: cipher.encrypt(password),
        keyVersion: cipher.currentVersion,
      },
    });
    return { uid: created.uid, password, country_code: created.countryCode };
  });

  registerRoute(app, ctx, integrationsApi.oauthCallback, async ({ userId, params, body }) => {
    await access.requireHome(userId!, params.home_id, 'admin');
    const provider = requireProvider(params.provider);

    // `take` lit et supprime : un état ne sert qu'une fois.
    const raw = await temp.take(`oauth:${body.state}`);
    if (!raw) throw new AppError('validation_failed', 'État d’autorisation inconnu ou expiré');

    const expected = JSON.parse(raw) as { homeId: string; userId: string; provider: string };
    if (
      expected.homeId !== params.home_id ||
      expected.userId !== userId ||
      expected.provider !== params.provider
    ) {
      throw new AppError('validation_failed', 'État d’autorisation incohérent');
    }

    const tokens = await provider.exchangeCode(body.code, redirectUri());

    const existing = await prisma.thirdPartyAccount.findFirst({
      where: {
        homeId: params.home_id,
        provider: params.provider as Protocol,
        accountLabel: tokens.accountLabel,
      },
    });

    // Champs communs à la création et à la mise à jour. Typé explicitement :
    // les entrées `update` de Prisma acceptent des opérateurs (`{ set: … }`)
    // que la variante `create` refuse, d'où l'inférence trop large sans annotation.
    const secrets = {
      accessTokenEnc: cipher.encrypt(tokens.accessToken),
      refreshTokenEnc: cipher.encrypt(tokens.refreshToken),
      keyVersion: cipher.currentVersion,
      expiresAt: tokens.expiresAt,
      reauthRequired: false,
    } satisfies Partial<Prisma.ThirdPartyAccountUncheckedCreateInput>;

    // Relier deux fois le même compte doit rafraîchir les jetons, pas créer un
    // doublon qui consommerait le quota en double.
    const account = existing
      ? await prisma.thirdPartyAccount.update({
          where: { id: existing.id },
          data: secrets,
          include: { _count: { select: { devices: true } } },
        })
      : await prisma.thirdPartyAccount.create({
          data: {
            homeId: params.home_id,
            provider: params.provider as Protocol,
            accountLabel: tokens.accountLabel,
            linkedByUserId: userId!,
            ...secrets,
          },
          include: { _count: { select: { devices: true } } },
        });

    return { account: toAccount(account) };
  });

  registerRoute(app, ctx, integrationsApi.discover, async ({ userId, params }) => {
    const account = await prisma.thirdPartyAccount.findUnique({ where: { id: params.account_id } });
    if (!account) throw notFound('Compte tiers introuvable');
    await access.requireHome(userId!, account.homeId, 'member');

    const token = await accounts.accessToken(params.account_id);
    const remote = await requireProvider(account.provider).listDevices(token);

    const imported = await prisma.device.findMany({
      where: { accountId: account.id },
      select: { externalId: true },
    });
    const importedIds = new Set(imported.map((d) => d.externalId));

    return {
      items: remote.map((d) => ({
        external_id: d.externalId,
        name: d.name,
        kind: d.kind as 'plug',
        imported: importedIds.has(d.externalId),
        supported: d.supported,
      })),
    };
  });

  registerRoute(app, ctx, integrationsApi.importDevices, async ({ userId, params, body }) => {
    const account = await prisma.thirdPartyAccount.findUnique({ where: { id: params.account_id } });
    if (!account) throw notFound('Compte tiers introuvable');
    await access.requireHome(userId!, account.homeId, 'member');

    const token = await accounts.accessToken(params.account_id);
    const remote = await requireProvider(account.provider).listDevices(token);
    const byId = new Map(remote.map((d) => [d.externalId, d]));

    const created = [];
    for (const externalId of body.external_ids) {
      const source = byId.get(externalId);
      if (!source) continue;
      if (!source.supported) {
        throw new AppError('validation_failed', `« ${source.name} » n’expose aucune capacité prise en charge`);
      }

      // `upsert` sur la clé (foyer, protocole, identifiant externe) : réimporter
      // ne crée pas de doublon et ne perd pas le nom donné par l'utilisateur.
      const device = await prisma.device.upsert({
        where: {
          homeId_protocol_externalId: {
            homeId: account.homeId,
            protocol: account.provider,
            externalId,
          },
        },
        update: { accountId: account.id },
        create: {
          homeId: account.homeId,
          name: source.name,
          kind: source.kind,
          protocol: account.provider,
          externalId,
          accountId: account.id,
          online: true,
          capabilities: {
            create: source.capabilities.map((c) => ({
              type: c.type,
              writable: c.writable,
              min: c.min ?? null,
              max: c.max ?? null,
              unit: c.unit ?? 'none',
            })),
          },
        },
        include: { capabilities: true },
      });

      created.push(await ctx.devices.toContractDevice(device));
      await events.publish(account.homeId, {
        type: 'device_added',
        device_id: device.id,
        name: device.name,
        kind: device.kind as 'plug',
      });
    }

    return { devices: created };
  });

  registerRoute(app, ctx, integrationsApi.unlink, async ({ userId, params, body }) => {
    const account = await prisma.thirdPartyAccount.findUnique({ where: { id: params.account_id } });
    if (!account) throw notFound('Compte tiers introuvable');
    await access.requireHome(userId!, account.homeId, 'admin');

    const attached = await prisma.device.findMany({
      where: { accountId: account.id },
      select: { id: true },
    });

    if (body.devices === 'keep_orphaned') {
      // Détachés avant la suppression, sinon la cascade les emporte. Ils
      // resteront visibles mais injoignables — d'où le choix explicite.
      await prisma.device.updateMany({ where: { accountId: account.id }, data: { accountId: null } });
    }
    await prisma.thirdPartyAccount.delete({ where: { id: account.id } });

    if (body.devices === 'delete') {
      for (const device of attached) {
        await events.publish(account.homeId, { type: 'device_removed', device_id: device.id });
      }
    }
    return { ok: true as const };
  });
}

export { conflict };
