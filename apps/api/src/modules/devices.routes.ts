import type { FastifyInstance } from 'fastify';
import { devices as devicesApi, type ChangeOrigin, type Protocol } from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { notFound } from '../http/errors.js';

export function registerDeviceRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, access, devices, state } = ctx;

  registerRoute(app, ctx, devicesApi.list, async ({ userId, params, query }) => {
    await access.requireHome(userId!, params.home_id);

    const rows = await prisma.device.findMany({
      where: {
        homeId: params.home_id,
        ...(query.room_id ? { roomId: query.room_id } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.protocol ? { protocol: query.protocol as Protocol } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      },
      include: { capabilities: true },
      orderBy: { name: 'asc' },
    });

    // Une seule lecture groupée de l'état chaud, pas une par appareil.
    const values = await state.getMany(rows.map((r) => r.id));
    return {
      items: await Promise.all(rows.map((r) => devices.toContractDevice(r, values.get(r.id) ?? {}))),
    };
  });

  registerRoute(app, ctx, devicesApi.get, async ({ userId, params }) => {
    const row = await access.requireDevice(userId!, params.device_id);
    return { device: await devices.toContractDevice(row) };
  });

  registerRoute(app, ctx, devicesApi.update, async ({ userId, params, body }) => {
    const row = await access.requireDevice(userId!, params.device_id, 'member');

    if (body.room_id) {
      // Une pièce d'un autre foyer ne doit pas pouvoir capter un appareil.
      const room = await prisma.room.findUnique({ where: { id: body.room_id } });
      if (!room || room.homeId !== row.homeId) throw notFound('Pièce introuvable');
    }

    const updated = await prisma.device.update({
      where: { id: params.device_id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.room_id !== undefined ? { roomId: body.room_id } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
      },
      include: { capabilities: true },
    });
    return { device: await devices.toContractDevice(updated) };
  });

  registerRoute(app, ctx, devicesApi.remove, async ({ userId, params }) => {
    await access.requireDevice(userId!, params.device_id, 'admin');
    await prisma.device.delete({ where: { id: params.device_id } });
    return { ok: true as const };
  });

  registerRoute(app, ctx, devicesApi.sendCommand, async ({ userId, params, body }) => {
    // `guest` suffit : piloter est justement ce qu'un invité a le droit de faire.
    await access.requireDevice(userId!, params.device_id, 'guest');
    const command = await devices.sendCommand(params.device_id, body, { userId: userId! });
    return { command };
  });

  registerRoute(app, ctx, devicesApi.getCommand, async ({ userId, params }) => {
    await access.requireDevice(userId!, params.device_id);
    const row = await prisma.command.findUnique({ where: { id: params.command_id } });
    if (!row || row.deviceId !== params.device_id) throw notFound('Commande introuvable');
    return {
      command: {
        command_id: row.id,
        device_id: row.deviceId,
        target: row.payload as never,
        status: row.status,
        ack_semantics: row.ackSemantics as never,
        timeout_ms: row.timeoutMs,
        issued_at: row.issuedAt.toISOString(),
        acked_at: row.ackedAt?.toISOString() ?? null,
        error: row.errorCode as never,
      },
    };
  });

  registerRoute(app, ctx, devicesApi.history, async ({ userId, params, query }) => {
    await access.requireDevice(userId!, params.device_id);

    // Le curseur est l'identifiant de la dernière ligne lue : une pagination par
    // offset dériverait à chaque nouvel événement inséré pendant la lecture.
    const cursor = query.cursor ? BigInt(query.cursor) : undefined;
    const rows = await prisma.stateChange.findMany({
      where: {
        deviceId: params.device_id,
        ...(query.since ? { at: { gte: new Date(query.since) } } : {}),
        ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const userIds = page.filter((r) => r.originKind === 'user' && r.originId).map((r) => r.originId!);
    const automationIds = page
      .filter((r) => r.originKind === 'automation' && r.originId)
      .map((r) => r.originId!);

    const [users, automations] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
        : [],
      automationIds.length
        ? prisma.automation.findMany({ where: { id: { in: automationIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const userById = new Map(users.map((u) => [u.id, u.displayName]));
    const automationById = new Map(automations.map((a) => [a.id, a.name]));

    return {
      items: page.map((r) => ({
        device_id: r.deviceId,
        capability: r.value as never,
        origin: toOrigin(r.originKind, r.originId, userById, automationById),
        at: r.at.toISOString(),
      })),
      next_cursor: rows.length > query.limit ? String(page.at(-1)?.id ?? '') : null,
    };
  });

  registerRoute(app, ctx, devicesApi.energy, async ({ userId, params, query }) => {
    await access.requireDevice(userId!, params.device_id);

    // Agrégation en SQL : ramener 90 jours de relevés pour les sommer en Node
    // ferait transiter des dizaines de milliers de lignes pour un graphique.
    const rows = await prisma.$queryRawUnsafe<{ bucket: Date; value: number }[]>(
      `SELECT date_trunc($1, "at") AS bucket, MAX((value->>'value')::float) - MIN((value->>'value')::float) AS value
       FROM state_changes
       WHERE "deviceId" = $2::uuid AND type = 'energy' AND "at" >= $3 AND "at" < $4
       GROUP BY bucket ORDER BY bucket ASC`,
      query.bucket,
      params.device_id,
      new Date(query.from),
      new Date(query.to),
    );

    return {
      unit: 'kWh' as const,
      points: rows.map((r) => ({ at: r.bucket.toISOString(), value: Math.max(0, r.value ?? 0) })),
    };
  });
}

function toOrigin(
  kind: string,
  id: string | null,
  users: Map<string, string>,
  automations: Map<string, string>,
): ChangeOrigin {
  if (kind === 'user' && id) {
    return { kind: 'user', user_id: id, display_name: users.get(id) ?? 'Membre retiré' };
  }
  if (kind === 'automation' && id) {
    return { kind: 'automation', automation_id: id, name: automations.get(id) ?? 'Scénario supprimé' };
  }
  if (kind === 'device') return { kind: 'device' };
  if (kind === 'external') return { kind: 'external', provider: 'inconnu' };
  return { kind: 'unknown' };
}
