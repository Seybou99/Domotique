import type { FastifyInstance } from 'fastify';
import { units as unitsApi, type DeviceUnit } from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { hashToken } from '../http/auth.js';

/**
 * Boîtiers (CDC §8.2 et §8.3).
 */

/** Le code du QR est court : sans plafond, il serait devinable par force brute. */
const CLAIM_ATTEMPTS = { limit: 10, windowS: 600 } as const;

export function registerUnitRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, access, events, pairing, limiter } = ctx;

  const toUnit = (
    u: {
      id: string;
      homeId: string | null;
      serial: string;
      name: string;
      online: boolean;
      lastHeartbeat: Date | null;
      agentVersion: string | null;
      certExpiresAt: Date | null;
    },
    deviceCount: number,
  ): DeviceUnit => ({
    id: u.id,
    home_id: u.homeId!,
    serial: u.serial,
    name: u.name,
    online: u.online,
    last_heartbeat: u.lastHeartbeat?.toISOString() ?? null,
    agent_version: u.agentVersion,
    // Exposé volontairement : un certificat expiré déconnecte le boîtier
    // définitivement, l'app doit pouvoir prévenir avant la panne.
    certificate_expires_at: u.certExpiresAt?.toISOString() ?? null,
    device_count: deviceCount,
  });

  registerRoute(app, ctx, unitsApi.list, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id);
    const rows = await prisma.deviceUnit.findMany({
      where: { homeId: params.home_id },
      include: { _count: { select: { devices: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map((u) => toUnit(u, u._count.devices)) };
  });

  /**
   * Association d'un boîtier à un foyer par QR code (CDC §8.2).
   *
   * Le code est à usage unique et daté. Il ne sert qu'ici : l'authentification
   * permanente du boîtier passe par son certificat mTLS, jamais par ce code.
   */
  registerRoute(app, ctx, unitsApi.claim, async ({ userId, body }) => {
    const retryAfter = await limiter.hit(
      `claim:${userId}`,
      CLAIM_ATTEMPTS.limit,
      CLAIM_ATTEMPTS.windowS,
    );
    if (retryAfter !== null) {
      throw new AppError('rate_limited', 'Trop de tentatives d’association', undefined, retryAfter);
    }

    await access.requireHome(userId!, body.home_id, 'admin');

    const unit = await prisma.deviceUnit.findUnique({
      where: { serial: body.serial },
      include: { claim: true },
    });

    // Message identique pour « série inconnue » et « code faux » : les
    // distinguer permettrait d'énumérer les numéros de série valides.
    const invalid = new AppError('not_found', 'Boîtier ou code d’appairage invalide');
    if (!unit?.claim) throw invalid;
    if (unit.claim.codeHash !== hashToken(body.claim_code)) throw invalid;

    if (unit.claim.usedAt) throw conflict('Ce code d’appairage a déjà été utilisé');
    if (unit.claim.expiresAt < new Date()) throw conflict('Ce code d’appairage a expiré');
    if (unit.homeId) throw conflict('Ce boîtier est déjà associé à un foyer');

    // Transaction : un boîtier associé sans que son code soit consommé pourrait
    // être réclamé une seconde fois.
    const [claimed] = await prisma.$transaction([
      prisma.deviceUnit.update({
        where: { id: unit.id },
        data: { homeId: body.home_id, name: body.name ?? unit.name },
      }),
      prisma.unitClaim.update({ where: { unitId: unit.id }, data: { usedAt: new Date() } }),
    ]);

    await events.publish(body.home_id, {
      type: 'unit_availability_changed',
      unit_id: claimed.id,
      online: claimed.online,
    });

    return { unit: toUnit(claimed, 0) };
  });

  registerRoute(app, ctx, unitsApi.remove, async ({ userId, params, body }) => {
    const unit = await prisma.deviceUnit.findUnique({ where: { id: params.unit_id } });
    if (!unit?.homeId) throw notFound('Boîtier introuvable');
    await access.requireHome(userId!, unit.homeId, 'admin');

    const attached = await prisma.device.findMany({
      where: { unitId: unit.id },
      select: { id: true },
    });

    if (body.devices === 'keep_orphaned') {
      // Détachés avant la suppression, sinon la cascade du schéma les emporte.
      // Ils resteront visibles mais injoignables — d'où le choix explicite.
      await prisma.device.updateMany({ where: { unitId: unit.id }, data: { unitId: null } });
    }
    await prisma.deviceUnit.delete({ where: { id: unit.id } });
    await pairing.close(unit.id);

    if (body.devices === 'delete') {
      for (const device of attached) {
        await events.publish(unit.homeId, { type: 'device_removed', device_id: device.id });
      }
    }
    return { ok: true as const };
  });

  registerRoute(app, ctx, unitsApi.startPairing, async ({ userId, params, body }) => {
    const unit = await prisma.deviceUnit.findUnique({ where: { id: params.unit_id } });
    if (!unit?.homeId) throw notFound('Boîtier introuvable');
    await access.requireHome(userId!, unit.homeId, 'member');

    const already = await pairing.status(params.unit_id);
    if (already) return { session: already };

    return { session: await pairing.open(params.unit_id, body.duration_s) };
  });

  registerRoute(app, ctx, unitsApi.stopPairing, async ({ userId, params }) => {
    const unit = await prisma.deviceUnit.findUnique({ where: { id: params.unit_id } });
    if (!unit?.homeId) throw notFound('Boîtier introuvable');
    await access.requireHome(userId!, unit.homeId, 'member');

    await pairing.close(params.unit_id);
    return { ok: true as const };
  });
}
