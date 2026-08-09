import type { FastifyInstance } from 'fastify';
import { homes as homesApi, type Home, type HomeRole } from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { conflict, notFound } from '../http/errors.js';

export function registerHomeRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, access, devices, state, events } = ctx;

  const toHome = (h: { id: string; name: string; address: string | null; timezone: string; createdAt: Date }, role: HomeRole): Home => ({
    id: h.id,
    name: h.name,
    // L'adresse n'est renvoyée qu'aux administrateurs : elle sert au fuseau et à
    // la météo, elle n'a pas à circuler auprès d'un invité.
    address: role === 'owner' || role === 'admin' ? h.address : null,
    timezone: h.timezone,
    my_role: role,
    created_at: h.createdAt.toISOString(),
  });

  registerRoute(app, ctx, homesApi.list, async ({ userId }) => {
    const memberships = await prisma.homeMember.findMany({
      where: { userId: userId!, joinedAt: { not: null } },
      include: { home: true },
      orderBy: { home: { createdAt: 'asc' } },
    });
    return { items: memberships.map((m) => toHome(m.home, m.role as HomeRole)) };
  });

  registerRoute(app, ctx, homesApi.create, async ({ userId, body }) => {
    const home = await prisma.home.create({
      data: {
        name: body.name,
        address: body.address ?? null,
        timezone: body.timezone,
        members: { create: { userId: userId!, role: 'owner', joinedAt: new Date() } },
      },
    });
    return { home: toHome(home, 'owner') };
  });

  registerRoute(app, ctx, homesApi.update, async ({ userId, params, body }) => {
    const role = await access.requireHome(userId!, params.home_id, 'admin');
    const home = await prisma.home.update({
      where: { id: params.home_id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      },
    });
    return { home: toHome(home, role) };
  });

  /**
   * Instantané complet — repli de la resynchronisation temps réel (CDC §5).
   *
   * L'`event_id` est lu **avant** les données : mieux vaut rejouer quelques
   * événements déjà pris en compte (les mises à jour sont idempotentes côté app)
   * que d'en manquer un survenu pendant la lecture.
   */
  registerRoute(app, ctx, homesApi.state, async ({ userId, params }) => {
    const role = await access.requireHome(userId!, params.home_id);
    const eventId = await events.lastEventId(params.home_id);

    const [home, roomRows, deviceRows, unitRows] = await Promise.all([
      prisma.home.findUnique({ where: { id: params.home_id } }),
      prisma.room.findMany({ where: { homeId: params.home_id }, orderBy: { sortOrder: 'asc' } }),
      prisma.device.findMany({
        where: { homeId: params.home_id },
        include: { capabilities: true },
        orderBy: { name: 'asc' },
      }),
      prisma.deviceUnit.findMany({ where: { homeId: params.home_id } }),
    ]);
    if (!home) throw notFound('Foyer introuvable');

    const values = await state.getMany(deviceRows.map((d) => d.id));
    const contractDevices = await Promise.all(
      deviceRows.map((d) => devices.toContractDevice(d, values.get(d.id) ?? {})),
    );

    const activeByRoom = new Map<string, number>();
    for (const device of contractDevices) {
      if (!device.room_id) continue;
      const on = device.capabilities.find((c) => c.type === 'on_off')?.value;
      if (on?.type === 'on_off' && on.value && device.online) {
        activeByRoom.set(device.room_id, (activeByRoom.get(device.room_id) ?? 0) + 1);
      }
    }

    return {
      home: toHome(home, role),
      rooms: roomRows.map((r) => ({
        id: r.id,
        home_id: r.homeId,
        name: r.name,
        icon: r.icon as 'salon',
        sort_order: r.sortOrder,
        device_count: contractDevices.filter((d) => d.room_id === r.id).length,
        active_device_count: activeByRoom.get(r.id) ?? 0,
      })),
      devices: contractDevices,
      units: unitRows.map((u) => ({
        id: u.id,
        // Non nul par construction : la requête filtre déjà sur ce foyer.
        home_id: params.home_id,
        serial: u.serial,
        name: u.name,
        online: u.online,
        last_heartbeat: u.lastHeartbeat?.toISOString() ?? null,
        agent_version: u.agentVersion,
        certificate_expires_at: u.certExpiresAt?.toISOString() ?? null,
        device_count: deviceRows.filter((d) => d.unitId === u.id).length,
      })),
      event_id: eventId,
    };
  });

  registerRoute(app, ctx, homesApi.members, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id);
    const members = await prisma.homeMember.findMany({
      where: { homeId: params.home_id },
      include: { user: true },
      orderBy: { invitedAt: 'asc' },
    });
    return {
      items: members.map((m) => ({
        user_id: m.userId,
        display_name: m.user.displayName,
        email: m.user.email,
        role: m.role as HomeRole,
        joined_at: m.joinedAt?.toISOString() ?? null,
        invited_at: m.invitedAt.toISOString(),
      })),
    };
  });

  registerRoute(app, ctx, homesApi.invite, async ({ userId, params, body }) => {
    await access.requireHome(userId!, params.home_id, 'admin');

    const invited = await prisma.user.findUnique({ where: { email: body.email } });
    if (!invited) throw notFound('Aucun compte pour cette adresse');

    const already = await prisma.homeMember.findUnique({
      where: { homeId_userId: { homeId: params.home_id, userId: invited.id } },
    });
    if (already) throw conflict('Cette personne est déjà membre du foyer');

    const member = await prisma.homeMember.create({
      data: { homeId: params.home_id, userId: invited.id, role: body.role },
    });
    return {
      member: {
        user_id: member.userId,
        display_name: invited.displayName,
        email: invited.email,
        role: member.role as HomeRole,
        joined_at: null,
        invited_at: member.invitedAt.toISOString(),
      },
    };
  });

  registerRoute(app, ctx, homesApi.removeMember, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id, 'admin');
    const target = await prisma.homeMember.findUnique({
      where: { homeId_userId: { homeId: params.home_id, userId: params.user_id } },
    });
    if (!target) throw notFound('Membre introuvable');
    // Retirer le propriétaire laisserait un foyer sans responsable : le transfert
    // de propriété est une action distincte, pas un effet de bord d'un retrait.
    if (target.role === 'owner') throw conflict('Le propriétaire ne peut pas être retiré');

    await prisma.homeMember.delete({
      where: { homeId_userId: { homeId: params.home_id, userId: params.user_id } },
    });
    return { ok: true as const };
  });
}
