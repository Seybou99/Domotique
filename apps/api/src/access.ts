import type { HomeRole } from '@domotique/contract';
import type { PrismaClient } from '@prisma/client';
import { forbidden, notFound } from './http/errors.js';

/**
 * Contrôle d'accès multi-tenant (CDC §7).
 *
 * Toute lecture ou écriture passe par une de ces fonctions. Elles renvoient
 * `not_found` plutôt que `forbidden` quand l'utilisateur n'est pas membre du
 * foyer : répondre « interdit » confirmerait l'existence de la ressource et
 * permettrait d'énumérer les foyers d'autrui.
 */

const RANK: Record<HomeRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export function atLeast(role: HomeRole, required: HomeRole): boolean {
  return RANK[role] >= RANK[required];
}

export function createAccess(prisma: PrismaClient) {
  /** Vérifie l'appartenance au foyer et renvoie le rôle. */
  async function requireHome(userId: string, homeId: string, required: HomeRole = 'guest') {
    const membership = await prisma.homeMember.findUnique({
      where: { homeId_userId: { homeId, userId } },
    });
    if (!membership || membership.joinedAt === null) throw notFound('Foyer introuvable');
    const role = membership.role as HomeRole;
    if (!atLeast(role, required)) {
      throw forbidden(`Rôle ${required} requis pour cette action`);
    }
    return role;
  }

  /** Résout un appareil en vérifiant au passage l'accès à son foyer. */
  async function requireDevice(userId: string, deviceId: string, required: HomeRole = 'guest') {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { capabilities: true, room: true },
    });
    if (!device) throw notFound('Appareil introuvable');
    await requireHome(userId, device.homeId, required);
    return device;
  }

  async function requireRoom(userId: string, roomId: string, required: HomeRole = 'member') {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw notFound('Pièce introuvable');
    await requireHome(userId, room.homeId, required);
    return room;
  }

  return { requireHome, requireDevice, requireRoom };
}

export type Access = ReturnType<typeof createAccess>;
