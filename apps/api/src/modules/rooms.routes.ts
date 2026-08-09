import type { FastifyInstance } from 'fastify';
import { rooms as roomsApi, type Room, type RoomIcon } from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { AppError } from '../http/errors.js';

export function registerRoomRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, access } = ctx;

  /**
   * Les compteurs de la carte de pièce (écran 1.1) sont calculés en base plutôt
   * qu'à partir de l'état chaud : sur une grille de six cartes, une requête
   * groupée vaut mieux que N lectures Redis. L'écart d'un appareil qui vient de
   * changer d'état est rattrapé dans la seconde par le canal temps réel.
   */
  async function toRooms(homeId: string): Promise<Room[]> {
    const [roomRows, counts] = await Promise.all([
      prisma.room.findMany({ where: { homeId }, orderBy: { sortOrder: 'asc' } }),
      prisma.device.groupBy({ by: ['roomId'], where: { homeId }, _count: { _all: true } }),
    ]);
    const countByRoom = new Map(counts.map((c) => [c.roomId, c._count._all]));
    return roomRows.map((r) => ({
      id: r.id,
      home_id: r.homeId,
      name: r.name,
      icon: r.icon as RoomIcon,
      sort_order: r.sortOrder,
      device_count: countByRoom.get(r.id) ?? 0,
      active_device_count: 0,
    }));
  }

  registerRoute(app, ctx, roomsApi.list, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id);
    return { items: await toRooms(params.home_id) };
  });

  registerRoute(app, ctx, roomsApi.create, async ({ userId, params, body }) => {
    await access.requireHome(userId!, params.home_id, 'member');

    const last = await prisma.room.findFirst({
      where: { homeId: params.home_id },
      orderBy: { sortOrder: 'desc' },
    });

    const room = await prisma.room.create({
      data: {
        homeId: params.home_id,
        name: body.name,
        icon: body.icon,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    if (body.device_ids.length > 0) {
      // `homeId` dans le filtre : on ne rattache pas un appareil d'un autre foyer,
      // même si son identifiant est fourni.
      await prisma.device.updateMany({
        where: { id: { in: body.device_ids }, homeId: params.home_id },
        data: { roomId: room.id },
      });
    }

    return {
      room: {
        id: room.id,
        home_id: room.homeId,
        name: room.name,
        icon: room.icon as RoomIcon,
        sort_order: room.sortOrder,
        device_count: body.device_ids.length,
        active_device_count: 0,
      },
    };
  });

  registerRoute(app, ctx, roomsApi.update, async ({ userId, params, body }) => {
    const existing = await access.requireRoom(userId!, params.room_id, 'member');
    const room = await prisma.room.update({
      where: { id: params.room_id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
      },
    });
    const count = await prisma.device.count({ where: { roomId: room.id } });
    return {
      room: {
        id: room.id,
        home_id: existing.homeId,
        name: room.name,
        icon: room.icon as RoomIcon,
        sort_order: room.sortOrder,
        device_count: count,
        active_device_count: 0,
      },
    };
  });

  registerRoute(app, ctx, roomsApi.remove, async ({ userId, params }) => {
    await access.requireRoom(userId!, params.room_id, 'admin');
    // `onDelete: SetNull` côté schéma : les appareils survivent sans pièce.
    await prisma.room.delete({ where: { id: params.room_id } });
    return { ok: true as const };
  });

  registerRoute(app, ctx, roomsApi.reorder, async ({ userId, params, body }) => {
    await access.requireHome(userId!, params.home_id, 'member');

    const owned = await prisma.room.findMany({
      where: { homeId: params.home_id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((r) => r.id));
    if (body.room_ids.some((id) => !ownedIds.has(id)) || body.room_ids.length !== ownedIds.size) {
      throw new AppError('validation_failed', 'La liste doit contenir exactement les pièces du foyer');
    }

    // Transaction : un ordre partiellement appliqué produirait des doublons de
    // position et un tableau de bord instable.
    await prisma.$transaction(
      body.room_ids.map((id, index) =>
        prisma.room.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return { items: await toRooms(params.home_id) };
  });
}
