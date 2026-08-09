import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  alerts as alertsApi,
  type Alert,
  type AlertCategory,
  type NotificationSettings,
} from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { notFound } from '../http/errors.js';

/**
 * Alertes et préférences de notification (onglet 4 du design system).
 */

/** Tout activé sauf `activity`, qui serait bruyant en push. */
const DEFAULT_CATEGORIES: NotificationSettings['by_category'] = {
  security: { push: true, email: false },
  safety: { push: true, email: true },
  connectivity: { push: true, email: false },
  activity: { push: false, email: false },
};

export function registerAlertRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, access } = ctx;

  const toAlert = (a: {
    id: string;
    homeId: string;
    deviceId: string | null;
    category: string;
    severity: string;
    title: string;
    body: string | null;
    read: boolean;
    createdAt: Date;
  }): Alert => ({
    id: a.id,
    home_id: a.homeId,
    device_id: a.deviceId,
    category: a.category as AlertCategory,
    severity: a.severity as Alert['severity'],
    title: a.title,
    body: a.body,
    read: a.read,
    created_at: a.createdAt.toISOString(),
  });

  /** Crée les préférences à la première lecture plutôt qu'à la création du foyer. */
  async function settingsFor(homeId: string): Promise<NotificationSettings> {
    const row =
      (await prisma.notificationSettings.findUnique({ where: { homeId } })) ??
      (await prisma.notificationSettings.create({
        data: { homeId, byCategory: DEFAULT_CATEGORIES, deviceOverrides: [] },
      }));

    return {
      home_id: row.homeId,
      by_category: row.byCategory as NotificationSettings['by_category'],
      device_overrides: row.deviceOverrides as NotificationSettings['device_overrides'],
      quiet_hours: (row.quietHours as NotificationSettings['quiet_hours']) ?? null,
    };
  }

  registerRoute(app, ctx, alertsApi.list, async ({ userId, params, query }) => {
    await access.requireHome(userId!, params.home_id);

    const where = {
      homeId: params.home_id,
      ...(query.category ? { category: query.category } : {}),
      ...(query.unread_only ? { read: false } : {}),
      // Curseur sur la date de création : une pagination par offset dériverait
      // à chaque nouvelle alerte insérée pendant la lecture.
      ...(query.cursor ? { createdAt: { lt: new Date(query.cursor) } } : {}),
    };

    const [rows, unread] = await Promise.all([
      prisma.alert.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.limit + 1 }),
      prisma.alert.count({ where: { homeId: params.home_id, read: false } }),
    ]);

    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAlert),
      next_cursor:
        rows.length > query.limit ? (page.at(-1)?.createdAt.toISOString() ?? null) : null,
      unread_count: unread,
    };
  });

  registerRoute(app, ctx, alertsApi.markRead, async ({ userId, params }) => {
    const alert = await prisma.alert.findUnique({ where: { id: params.alert_id } });
    if (!alert) throw notFound('Alerte introuvable');
    await access.requireHome(userId!, alert.homeId);

    // `updateMany` avec le filtre `read: false` : marquer deux fois ne réécrit
    // pas la ligne inutilement.
    await prisma.alert.updateMany({ where: { id: alert.id, read: false }, data: { read: true } });
    return { ok: true as const };
  });

  registerRoute(app, ctx, alertsApi.markAllRead, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id);
    await prisma.alert.updateMany({
      where: { homeId: params.home_id, read: false },
      data: { read: true },
    });
    return { ok: true as const };
  });

  registerRoute(app, ctx, alertsApi.getSettings, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id);
    return { settings: await settingsFor(params.home_id) };
  });

  registerRoute(app, ctx, alertsApi.updateSettings, async ({ userId, params, body }) => {
    await access.requireHome(userId!, params.home_id, 'member');
    const current = await settingsFor(params.home_id);

    // Fusion par catégorie : envoyer une seule catégorie ne doit pas effacer
    // les autres.
    const byCategory = { ...current.by_category, ...(body.by_category ?? {}) };

    const row = await prisma.notificationSettings.update({
      where: { homeId: params.home_id },
      data: {
        byCategory,
        ...(body.device_overrides !== undefined ? { deviceOverrides: body.device_overrides } : {}),
        // Prisma distingue « absent » de « NULL SQL » : sans `DbNull`, effacer
        // les heures calmes est impossible.
        ...(body.quiet_hours !== undefined
          ? { quietHours: body.quiet_hours ?? Prisma.DbNull }
          : {}),
      },
    });

    return {
      settings: {
        home_id: row.homeId,
        by_category: row.byCategory as NotificationSettings['by_category'],
        device_overrides: row.deviceOverrides as NotificationSettings['device_overrides'],
        quiet_hours: (row.quietHours as NotificationSettings['quiet_hours']) ?? null,
      },
    };
  });

  /**
   * Enregistrement du jeton push de cet appareil mobile.
   *
   * `upsert` sur le jeton : réinstaller l'app sur le même téléphone réattribue
   * le jeton au bon compte au lieu d'échouer sur la contrainte d'unicité.
   */
  registerRoute(app, ctx, alertsApi.registerPushToken, async ({ userId, body }) => {
    await prisma.pushToken.upsert({
      where: { token: body.token },
      update: { userId: userId!, platform: body.platform, lastSeen: new Date() },
      create: { userId: userId!, platform: body.platform, token: body.token },
    });
    return { ok: true as const };
  });

  registerRoute(app, ctx, alertsApi.unregisterPushToken, async ({ userId, body }) => {
    // Filtré sur l'utilisateur : personne ne peut désinscrire le téléphone d'un autre.
    await prisma.pushToken.deleteMany({ where: { token: body.token, userId: userId! } });
    return { ok: true as const };
  });
}
